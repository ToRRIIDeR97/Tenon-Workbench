// P2 · Dictation, AC-2.1 (implementations/notes-command-centre/implementation.md).
// Drives the real binary over stdio; needs no microphone and no model.
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn read_event(lines: &mut impl Iterator<Item = std::io::Result<String>>, kind: &str) -> serde_json::Value {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        let line = lines.next().expect("engine closed stdout").expect("read line");
        let value: serde_json::Value = serde_json::from_str(&line).expect("engine wrote JSON lines");
        if value["type"] == kind {
            return value;
        }
    }
    panic!("no {kind} event");
}

#[test]
fn unknown_requests_get_bad_request_and_the_engine_keeps_running() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_tenon-dictation"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("start tenon-dictation");
    let mut stdin = child.stdin.take().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();

    read_event(&mut lines, "ready");
    writeln!(stdin, r#"{{"id":"1","type":"teleport"}}"#).unwrap();
    let error = read_event(&mut lines, "error");
    assert_eq!(error["code"], "bad_request");
    assert_eq!(error["id"], "1");

    // Still alive: a stop without a recording is answered, not a crash.
    writeln!(stdin, r#"{{"id":"2","type":"stop"}}"#).unwrap();
    let answer = read_event(&mut lines, "error");
    assert_eq!(answer["id"], "2");
    assert!(child.try_wait().unwrap().is_none());
    child.kill().ok();
}

#[test]
fn transcribe_file_without_a_loaded_model_reports_an_error() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_tenon-dictation"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("start tenon-dictation");
    let mut stdin = child.stdin.take().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    read_event(&mut lines, "ready");
    writeln!(stdin, r#"{{"id":"7","type":"transcribe_file","path":"missing.wav"}}"#).unwrap();
    let error = read_event(&mut lines, "error");
    assert_eq!(error["id"], "7");
    child.kill().ok();
}
