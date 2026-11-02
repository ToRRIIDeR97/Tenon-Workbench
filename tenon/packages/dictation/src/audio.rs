//! Audio helpers: the recording sink (levels + collected samples), WAV input and earshot VAD
//! trimming. Approach follows Handy's audio toolkit (https://github.com/cjpais/Handy, MIT).

use handy_recorder::{AudioChunk, Sink};
use serde_json::json;

use crate::Events;

pub const SAMPLE_RATE: u32 = 16_000;
/// earshot scores 16 ms frames of 256 samples at 16 kHz.
const VAD_FRAME: usize = 256;
const VAD_THRESHOLD: f32 = 0.5;
/// Speech padding kept on both sides of the detected speech, in frames (about 240 ms).
const VAD_PADDING_FRAMES: usize = 15;
/// A level event every few chunks (480-frame chunks are 30 ms) keeps the meter smooth without flooding stdout.
const LEVEL_EVERY_CHUNKS: u32 = 3;

/// Collects the 16 kHz mono recording and reports its loudness while it runs.
pub struct LevelSink {
    events: Events,
    samples: Vec<f32>,
    square_sum: f32,
    square_count: usize,
    chunks: u32,
}

impl LevelSink {
    pub fn new(events: Events) -> Self {
        Self {
            events,
            samples: Vec::new(),
            square_sum: 0.0,
            square_count: 0,
            chunks: 0,
        }
    }

    pub fn into_samples(self) -> Vec<f32> {
        self.samples
    }
}

impl Sink for LevelSink {
    fn process_chunk(&mut self, chunk: AudioChunk<'_>) {
        let real = &chunk.samples[..chunk.valid_frames * chunk.channels as usize];
        self.samples.extend_from_slice(real);
        self.square_sum += real.iter().map(|s| s * s).sum::<f32>();
        self.square_count += real.len();
        self.chunks += 1;
        if self.chunks % LEVEL_EVERY_CHUNKS != 0 || self.square_count == 0 {
            return;
        }
        let rms = (self.square_sum / self.square_count as f32).sqrt();
        self.square_sum = 0.0;
        self.square_count = 0;
        self.events
            .send(json!({ "type": "level", "rms": (rms * 1000.0).round() / 1000.0 }));
    }
}

/// The span of `samples` that holds speech, padded; empty when earshot hears no speech.
pub fn trim_to_speech(samples: &[f32]) -> &[f32] {
    let mut detector = earshot::Detector::default_boxed();
    let voiced: Vec<usize> = samples
        .chunks_exact(VAD_FRAME)
        .enumerate()
        .filter_map(|(index, frame)| {
            let clamped: Vec<f32> = frame.iter().map(|s| s.clamp(-1.0, 1.0)).collect();
            (detector.predict_f32(&clamped) >= VAD_THRESHOLD).then_some(index)
        })
        .collect();
    let (Some(first), Some(last)) = (voiced.first(), voiced.last()) else {
        return &[];
    };
    let start = first.saturating_sub(VAD_PADDING_FRAMES) * VAD_FRAME;
    let end = ((last + 1 + VAD_PADDING_FRAMES) * VAD_FRAME).min(samples.len());
    &samples[start..end]
}

/// Reads a PCM WAV file as 16 kHz mono f32, mixing channels down and resampling linearly.
pub fn read_wav_16k_mono(path: &str) -> Result<Vec<f32>, String> {
    let mut reader =
        hound::WavReader::open(path).map_err(|e| format!("Cannot read {path}: {e}"))?;
    let spec = reader.spec();
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<_, _>>(),
        hound::SampleFormat::Int => {
            let scale = (1_i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / scale))
                .collect::<Result<_, _>>()
        }
    }
    .map_err(|e| format!("Cannot decode {path}: {e}"))?;
    let channels = spec.channels.max(1) as usize;
    let mono: Vec<f32> = interleaved
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect();
    Ok(resample_linear(&mono, spec.sample_rate, SAMPLE_RATE))
}

fn resample_linear(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let length = (samples.len() as f64 / ratio).floor() as usize;
    (0..length)
        .map(|index| {
            let position = index as f64 * ratio;
            let base = position.floor() as usize;
            let next = (base + 1).min(samples.len() - 1);
            let fraction = (position - base as f64) as f32;
            samples[base] * (1.0 - fraction) + samples[next] * fraction
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_has_no_speech() {
        assert!(trim_to_speech(&vec![0.0; 16_000]).is_empty());
    }

    #[test]
    fn resampling_halves_the_length_from_32k() {
        assert_eq!(
            resample_linear(&vec![0.5; 3_200], 32_000, 16_000).len(),
            1_600
        );
    }
}
