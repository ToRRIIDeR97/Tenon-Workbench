//! tenon-dictation: local speech-to-text for Tenon Workbench, spoken over JSON lines on stdio.
//!
//! Built on the same stack as Handy (https://github.com/cjpais/Handy, MIT, Copyright (c) 2025
//! CJ Pais): `handy-recorder` for the microphone, `earshot` for voice activity and
//! `transcribe-cpp` for GGUF Whisper/Parakeet models. Stdout carries only protocol events;
//! diagnostics go to stderr.
//!
//! Requests: {"id","type":"load","model"} {"id","type":"start"} {"id","type":"stop"}
//!           {"id","type":"cancel"} {"id","type":"transcribe_file","path"}
//! Events:   {"type":"ready"} {"type":"level","rms"} {"type":"final","id","text"}
//!           {"type":"error","id"?,"code","message"}

mod audio;

use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};

use handy_recorder::{ErrorKind, Recorder, RecorderConfig};
use serde_json::{json, Value};
use transcribe_cpp::{Model, RunOptions, Session};

use audio::LevelSink;

#[derive(Clone)]
pub struct Events(Arc<Mutex<std::io::Stdout>>);

impl Events {
    pub fn send(&self, event: Value) {
        let mut out = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // A closed stdout means the supervisor is gone; the stdin loop ends on its own.
        let _ = writeln!(out, "{event}").and_then(|_| out.flush());
    }

    fn error(&self, id: Option<&str>, code: &str, message: impl Into<String>) {
        let mut event = json!({ "type": "error", "code": code, "message": message.into() });
        if let Some(id) = id {
            event["id"] = json!(id);
        }
        self.send(event);
    }
}

type SharedSession = Arc<Mutex<Option<Session>>>;

struct Engine {
    events: Events,
    session: SharedSession,
    recorder: Option<Recorder<LevelSink>>,
}

fn main() {
    let events = Events(Arc::new(Mutex::new(std::io::stdout())));
    let mut engine = Engine {
        events: events.clone(),
        session: Arc::new(Mutex::new(None)),
        recorder: None,
    };
    events.send(json!({ "type": "ready" }));

    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        engine.handle(&line);
    }
}

impl Engine {
    fn handle(&mut self, line: &str) {
        // Windows shells may prefix piped input with a byte-order mark.
        let line = line.trim_start_matches('\u{feff}');
        let Ok(request) = serde_json::from_str::<Value>(line) else {
            return self
                .events
                .error(None, "bad_request", "Request is not a JSON object");
        };
        let id = request.get("id").and_then(Value::as_str).map(str::to_owned);
        let id = id.as_deref();
        match request.get("type").and_then(Value::as_str) {
            Some("load") => match request.get("model").and_then(Value::as_str) {
                Some(path) => self.load(id, path),
                None => self
                    .events
                    .error(id, "bad_request", "load needs a model path"),
            },
            Some("start") => self.start(id),
            Some("stop") => self.stop(id),
            Some("cancel") => self.cancel(),
            Some("transcribe_file") => match request.get("path").and_then(Value::as_str) {
                Some(path) => self.transcribe_file(id, path),
                None => self
                    .events
                    .error(id, "bad_request", "transcribe_file needs a path"),
            },
            Some(other) => {
                self.events
                    .error(id, "bad_request", format!("Unknown request type {other}"))
            }
            None => self.events.error(id, "bad_request", "Request has no type"),
        }
    }

    fn load(&mut self, id: Option<&str>, path: &str) {
        let loaded = Model::load(path).and_then(|model| model.session());
        match loaded {
            Ok(session) => {
                *self.session.lock().unwrap_or_else(|p| p.into_inner()) = Some(session);
                self.events.send(json!({ "type": "ready" }));
            }
            Err(error) => self.events.error(id, "load_failed", error.to_string()),
        }
    }

    fn has_model(&self) -> bool {
        self.session.lock().map(|s| s.is_some()).unwrap_or(false)
    }

    fn start(&mut self, id: Option<&str>) {
        if self.recorder.is_some() {
            return self
                .events
                .error(id, "already_recording", "Already recording");
        }
        if !self.has_model() {
            return self
                .events
                .error(id, "no_model", "No speech model is loaded");
        }
        let failures = self.events.clone();
        let opened = Recorder::open_with_failure_handler(RecorderConfig::speech(), move |error| {
            failures.error(None, microphone_code(error.kind()), error.to_string());
        });
        let recorder = match opened {
            Ok(recorder) => recorder,
            Err(error) => {
                return self
                    .events
                    .error(id, microphone_code(error.kind()), error.to_string())
            }
        };
        if let Err(error) = recorder.start(LevelSink::new(self.events.clone())) {
            return self.events.error(
                id,
                microphone_code(error.error.kind()),
                error.error.to_string(),
            );
        }
        self.recorder = Some(recorder);
    }

    fn stop(&mut self, id: Option<&str>) {
        let Some(recorder) = self.recorder.take() else {
            return self.events.error(id, "not_recording", "Not recording");
        };
        let stopped = recorder.stop();
        // Closing releases the microphone (and the OS recording indicator) between dictations.
        drop(recorder);
        let samples = match stopped {
            Ok(stopped) => stopped.sink.into_samples(),
            Err(error) => {
                return self
                    .events
                    .error(id, microphone_code(error.kind()), error.to_string())
            }
        };
        self.transcribe(id, samples);
    }

    fn cancel(&mut self) {
        if let Some(recorder) = self.recorder.take() {
            let _ = recorder.stop();
        }
    }

    fn transcribe_file(&mut self, id: Option<&str>, path: &str) {
        if !self.has_model() {
            return self
                .events
                .error(id, "no_model", "No speech model is loaded");
        }
        match audio::read_wav_16k_mono(path) {
            Ok(samples) => self.transcribe(id, samples),
            Err(message) => self.events.error(id, "bad_audio", message),
        }
    }

    /// Runs the model on a worker thread so `cancel` and new requests are still read meanwhile.
    fn transcribe(&self, id: Option<&str>, samples: Vec<f32>) {
        let events = self.events.clone();
        let session = self.session.clone();
        let id = id.map(str::to_owned);
        std::thread::spawn(move || {
            let speech = audio::trim_to_speech(&samples);
            // Silence (or a muted mic) gives no text instead of a model hallucination.
            if speech.is_empty() {
                return events.send(json!({ "type": "final", "id": id, "text": "" }));
            }
            let mut guard = session.lock().unwrap_or_else(|p| p.into_inner());
            let Some(session) = guard.as_mut() else {
                return events.error(id.as_deref(), "no_model", "No speech model is loaded");
            };
            match session.run(speech, &RunOptions::default()) {
                Ok(result) => {
                    events.send(json!({ "type": "final", "id": id, "text": result.text.trim() }))
                }
                Err(error) => events.error(id.as_deref(), "transcribe_failed", error.to_string()),
            }
        });
    }
}

fn microphone_code(kind: ErrorKind) -> &'static str {
    match kind {
        ErrorKind::PermissionDenied => "permission_denied",
        ErrorKind::DeviceUnavailable => "no_microphone",
        ErrorKind::DeviceBusy => "microphone_busy",
        _ => "microphone_failed",
    }
}
