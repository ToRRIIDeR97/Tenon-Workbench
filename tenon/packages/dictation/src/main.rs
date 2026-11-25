mod audio;
mod language;

use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use handy_recorder::{ErrorKind, Recorder, RecorderConfig};
use serde_json::{json, Value};
use transcribe_cpp::{CancelToken, Model, RunOptions, Session};

use audio::{LevelSink, SharedSamples};

const PREVIEW_EVERY: Duration = Duration::from_millis(1200);
const PREVIEW_MIN_SAMPLES: usize = 12_800;
const PREVIEW_MAX_SAMPLES: usize = 28 * 16_000;

#[derive(Clone)]
pub struct Events(Arc<Mutex<std::io::Stdout>>);

impl Events {
    pub fn send(&self, event: Value) {
        let mut out = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
    languages: Arc<Vec<String>>,
    language: Option<String>,
    preview: Option<CancelToken>,
}

fn main() {
    let events = Events(Arc::new(Mutex::new(std::io::stdout())));
    let mut engine = Engine {
        events: events.clone(),
        session: Arc::new(Mutex::new(None)),
        recorder: None,
        languages: Arc::new(Vec::new()),
        language: None,
        preview: None,
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
            Some("start") => self.start(
                id,
                request
                    .get("language")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            ),
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
        let loaded = Model::load(path).and_then(|model| {
            let languages = model
                .capabilities()
                .map(|caps| caps.languages)
                .unwrap_or_default();
            model.session().map(|session| (session, languages))
        });
        match loaded {
            Ok((session, languages)) => {
                *self.session.lock().unwrap_or_else(|p| p.into_inner()) = Some(session);
                self.languages = Arc::new(languages);
                self.events.send(json!({ "type": "ready" }));
            }
            Err(error) => self.events.error(id, "load_failed", error.to_string()),
        }
    }

    fn has_model(&self) -> bool {
        self.session.lock().map(|s| s.is_some()).unwrap_or(false)
    }

    fn start(&mut self, id: Option<&str>, language: Option<String>) {
        if self.recorder.is_some() {
            return self
                .events
                .error(id, "already_recording", "Already recording");
        }
        self.language = language;
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
        let sink = LevelSink::new(self.events.clone());
        let samples = sink.shared();
        if let Err(error) = recorder.start(sink) {
            return self.events.error(
                id,
                microphone_code(error.error.kind()),
                error.error.to_string(),
            );
        }
        self.recorder = Some(recorder);
        self.preview = Some(self.start_preview(samples));
    }

    fn run_options(&self) -> RunOptions {
        language::run_options(self.language.as_deref(), &self.languages)
    }

    fn stop_preview(&mut self) {
        if let Some(token) = self.preview.take() {
            token.cancel();
        }
    }

    fn start_preview(&self, samples: SharedSamples) -> CancelToken {
        let stopped = CancelToken::new();
        let token = stopped.clone();
        let events = self.events.clone();
        let session = self.session.clone();
        let options = self.run_options();
        std::thread::spawn(move || {
            let mut last = String::new();
            loop {
                std::thread::sleep(PREVIEW_EVERY);
                if token.is_cancelled() {
                    return;
                }
                let clip = {
                    let all = samples.lock().unwrap_or_else(|p| p.into_inner());
                    all[all.len().saturating_sub(PREVIEW_MAX_SAMPLES)..].to_vec()
                };
                if clip.len() < PREVIEW_MIN_SAMPLES {
                    continue;
                }
                let speech = audio::trim_to_speech(&clip);
                if speech.is_empty() {
                    continue;
                }
                let Ok(mut guard) = session.try_lock() else {
                    continue;
                };
                let Some(model) = guard.as_mut() else { return };
                model.set_cancel_token(&token);
                let result = model.run(speech, &options);
                model.clear_cancel_token();
                drop(guard);
                if token.is_cancelled() {
                    return;
                }
                let Ok(result) = result else { continue };
                let text = result.text.trim().to_owned();
                if text.is_empty() || text == last {
                    continue;
                }
                events.send(json!({ "type": "partial", "text": text }));
                last = text;
            }
        });
        stopped
    }

    fn stop(&mut self, id: Option<&str>) {
        self.stop_preview();
        let Some(recorder) = self.recorder.take() else {
            return self.events.error(id, "not_recording", "Not recording");
        };
        let stopped = recorder.stop();
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
        self.stop_preview();
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

    fn transcribe(&self, id: Option<&str>, samples: Vec<f32>) {
        let events = self.events.clone();
        let session = self.session.clone();
        let options = self.run_options();
        let id = id.map(str::to_owned);
        std::thread::spawn(move || {
            let speech = audio::trim_to_speech(&samples);
            if speech.is_empty() {
                return events.send(json!({ "type": "final", "id": id, "text": "" }));
            }
            let mut guard = session.lock().unwrap_or_else(|p| p.into_inner());
            let Some(session) = guard.as_mut() else {
                return events.error(id.as_deref(), "no_model", "No speech model is loaded");
            };
            match session.run(speech, &options) {
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
