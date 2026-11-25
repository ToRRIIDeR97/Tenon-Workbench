pub fn run_language(requested: Option<&str>, supported: &[String]) -> Option<String> {
    let code = requested?.trim();
    if code.is_empty() || code == "auto" {
        return None;
    }
    supported
        .iter()
        .any(|item| item.eq_ignore_ascii_case(code))
        .then(|| code.to_ascii_lowercase())
}

pub fn run_options(requested: Option<&str>, supported: &[String]) -> transcribe_cpp::RunOptions {
    transcribe_cpp::RunOptions {
        task: transcribe_cpp::Task::Transcribe,
        language: run_language(requested, supported),
        target_language: None,
        ..transcribe_cpp::RunOptions::default()
    }
}

#[cfg(test)]
mod tests {
    use super::{run_language, run_options};

    #[test]
    fn an_english_recording_transcribes_in_english_and_never_translates() {
        let options = run_options(Some("en"), &langs(&["en", "es", "zh"]));
        assert_eq!(options.task, transcribe_cpp::Task::Transcribe);
        assert_eq!(options.language, Some("en".to_string()));
        assert_eq!(options.target_language, None);
        let detect = run_options(None, &langs(&["en"]));
        assert_eq!(detect.task, transcribe_cpp::Task::Transcribe);
        assert_eq!(detect.language, None);
    }

    fn langs(codes: &[&str]) -> Vec<String> {
        codes.iter().map(|code| code.to_string()).collect()
    }

    #[test]
    fn a_supported_language_is_passed() {
        assert_eq!(
            run_language(Some("en"), &langs(&["en", "zh"])),
            Some("en".to_string())
        );
    }

    #[test]
    fn auto_and_missing_languages_ask_the_model_to_detect() {
        assert_eq!(run_language(Some("auto"), &langs(&["en"])), None);
        assert_eq!(run_language(None, &langs(&["en"])), None);
        assert_eq!(run_language(Some(""), &langs(&["en"])), None);
    }

    #[test]
    fn an_unsupported_language_is_dropped() {
        assert_eq!(run_language(Some("xx"), &langs(&["en", "zh"])), None);
    }

    #[test]
    fn a_language_agnostic_model_gets_no_hint() {
        assert_eq!(run_language(Some("en"), &[]), None);
    }
}
