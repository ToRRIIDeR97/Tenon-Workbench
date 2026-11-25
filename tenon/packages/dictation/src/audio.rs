use std::sync::{Arc, Mutex};

use handy_recorder::{AudioChunk, Sink};
use serde_json::json;

use crate::Events;

pub const SAMPLE_RATE: u32 = 16_000;
const VAD_FRAME: usize = 256;
const VAD_THRESHOLD: f32 = 0.5;
const VAD_PADDING_FRAMES: usize = 15;
const LEVEL_EVERY_CHUNKS: u32 = 3;

pub const BAND_WINDOW: usize = 512;
pub const BAND_COUNT: usize = 24;
const BAND_LOW_HZ: f32 = 80.0;
const BAND_HIGH_HZ: f32 = 6_000.0;
const BAND_FLOOR_DB: f32 = 60.0;

pub type SharedSamples = Arc<Mutex<Vec<f32>>>;

pub struct LevelSink {
    events: Events,
    samples: SharedSamples,
    square_sum: f32,
    square_count: usize,
    chunks: u32,
}

impl LevelSink {
    pub fn new(events: Events) -> Self {
        Self {
            events,
            samples: Arc::new(Mutex::new(Vec::new())),
            square_sum: 0.0,
            square_count: 0,
            chunks: 0,
        }
    }

    pub fn shared(&self) -> SharedSamples {
        self.samples.clone()
    }

    pub fn into_samples(self) -> Vec<f32> {
        std::mem::take(&mut *self.samples.lock().unwrap_or_else(|p| p.into_inner()))
    }
}

impl Sink for LevelSink {
    fn process_chunk(&mut self, chunk: AudioChunk<'_>) {
        let real = &chunk.samples[..chunk.valid_frames * chunk.channels as usize];
        let bands = {
            let mut samples = self.samples.lock().unwrap_or_else(|p| p.into_inner());
            samples.extend_from_slice(real);
            frequency_bands(
                &samples[samples.len().saturating_sub(BAND_WINDOW)..],
                BAND_COUNT,
            )
        };
        let values: Vec<f32> = bands
            .iter()
            .map(|value| (value * 100.0).round() / 100.0)
            .collect();
        self.events
            .send(json!({ "type": "bands", "values": values }));
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

pub fn frequency_bands(samples: &[f32], count: usize) -> Vec<f32> {
    let n = samples.len().min(BAND_WINDOW);
    if n == 0 {
        return vec![0.0; count];
    }
    let size = n as f32;
    let windowed: Vec<f32> = samples[samples.len() - n..]
        .iter()
        .enumerate()
        .map(|(index, sample)| {
            sample
                * (0.5
                    - 0.5
                        * (2.0 * std::f32::consts::PI * index as f32 / (size - 1.0).max(1.0)).cos())
        })
        .collect();
    let bin = 16_000.0 / size;
    let ratio = BAND_HIGH_HZ / BAND_LOW_HZ;
    (0..count)
        .map(|band| {
            let low = BAND_LOW_HZ * ratio.powf(band as f32 / count as f32);
            let high = BAND_LOW_HZ * ratio.powf((band + 1) as f32 / count as f32);
            let mut peak = 0.0f32;
            let mut frequency = low;
            loop {
                peak = peak.max(goertzel(&windowed, frequency.min(high)));
                frequency += bin;
                if frequency > high {
                    break;
                }
            }
            if band_is_narrow(low, high, bin) {
                peak = peak.max(goertzel(&windowed, (low + high) / 2.0));
            }
            let magnitude = peak / (size / 4.0);
            if magnitude <= 0.0 {
                return 0.0;
            }
            ((20.0 * magnitude.log10() + BAND_FLOOR_DB) / BAND_FLOOR_DB).clamp(0.0, 1.0)
        })
        .collect()
}

fn band_is_narrow(low: f32, high: f32, bin: f32) -> bool {
    high - low < bin
}

fn goertzel(windowed: &[f32], frequency: f32) -> f32 {
    let coefficient = 2.0 * (2.0 * std::f32::consts::PI * frequency / 16_000.0).cos();
    let (mut previous, mut before) = (0.0f32, 0.0f32);
    for sample in windowed {
        let current = sample + coefficient * previous - before;
        before = previous;
        previous = current;
    }
    (previous * previous + before * before - coefficient * previous * before)
        .max(0.0)
        .sqrt()
}

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

    fn sine(freq: f32, amplitude: f32) -> Vec<f32> {
        (0..BAND_WINDOW)
            .map(|n| amplitude * (2.0 * std::f32::consts::PI * freq * n as f32 / 16_000.0).sin())
            .collect()
    }

    #[test]
    fn bands_are_quiet_for_silence() {
        let bands = frequency_bands(&vec![0.0; BAND_WINDOW], BAND_COUNT);
        assert_eq!(bands.len(), BAND_COUNT);
        assert!(bands.iter().all(|value| *value == 0.0));
    }

    #[test]
    fn a_tone_lights_the_band_it_falls_in() {
        let low = frequency_bands(&sine(200.0, 0.5), BAND_COUNT);
        let high = frequency_bands(&sine(3_000.0, 0.5), BAND_COUNT);
        let peak = |bands: &[f32]| {
            bands.iter().enumerate().fold(
                0,
                |best, (index, value)| if *value > bands[best] { index } else { best },
            )
        };
        assert!(peak(&low) < BAND_COUNT / 3, "200 Hz peaks low: {:?}", low);
        assert!(
            peak(&high) > BAND_COUNT * 2 / 3,
            "3 kHz peaks high: {:?}",
            high
        );
        assert!(low
            .iter()
            .chain(high.iter())
            .all(|value| (0.0..=1.0).contains(value)));
    }

    #[test]
    fn a_louder_voice_draws_taller_bars() {
        let quiet = frequency_bands(&sine(500.0, 0.02), BAND_COUNT);
        let loud = frequency_bands(&sine(500.0, 0.5), BAND_COUNT);
        let max = |bands: &[f32]| bands.iter().cloned().fold(0.0, f32::max);
        assert!(max(&loud) > max(&quiet));
    }

    #[test]
    fn resampling_halves_the_length_from_32k() {
        assert_eq!(
            resample_linear(&vec![0.5; 3_200], 32_000, 16_000).len(),
            1_600
        );
    }
}
