use serde::{Deserialize, Serialize};
use std::io::{self, Read};

#[derive(Deserialize)] struct Sample { input: Vec<f64>, success: bool }
#[derive(Deserialize)] struct Request { action: String, samples: Option<Vec<Sample>>, input: Option<Vec<f64>>, weights: Option<Vec<f64>>, bias: Option<f64>, epochs: Option<usize>, learning_rate: Option<f64> }
#[derive(Serialize)] struct Reply { weights: Vec<f64>, bias: f64, probability: Option<f64>, loss: Option<f64>, accuracy: Option<f64>, samples: usize }

fn sigmoid(value: f64) -> f64 { if value >= 0.0 { 1.0 / (1.0 + (-value).exp()) } else { let e = value.exp(); e / (1.0 + e) } }
fn main() {
    let mut raw = String::new(); io::stdin().read_to_string(&mut raw).unwrap();
    let request: Request = serde_json::from_str(&raw).unwrap();
    if request.action == "predict" {
        let input = request.input.unwrap(); let weights = request.weights.unwrap(); let bias = request.bias.unwrap_or(0.0);
        let probability = sigmoid(bias + input.iter().zip(weights.iter()).map(|(x, w)| x * w).sum::<f64>());
        println!("{}", serde_json::to_string(&Reply { weights, bias, probability: Some(probability), loss: None, accuracy: None, samples: 0 }).unwrap()); return;
    }
    let samples = request.samples.unwrap_or_default(); let width = samples.first().map(|item| item.input.len()).unwrap_or(0);
    let mut weights = request.weights.unwrap_or_else(|| vec![0.0; width]); let mut bias = request.bias.unwrap_or(0.0);
    let rate = request.learning_rate.unwrap_or(0.045); let epochs = request.epochs.unwrap_or(180);
    for _ in 0..epochs { for sample in &samples { let target = if sample.success { 1.0 } else { 0.0 }; let p = sigmoid(bias + sample.input.iter().zip(weights.iter()).map(|(x,w)| x*w).sum::<f64>()); let error = p - target; for (index, value) in sample.input.iter().enumerate() { let current = weights[index]; weights[index] -= rate * (error * value + 0.0001 * current); } bias -= rate * error; } }
    let mut loss = 0.0; let mut correct = 0usize;
    for sample in &samples { let target = if sample.success { 1.0 } else { 0.0 }; let p = sigmoid(bias + sample.input.iter().zip(weights.iter()).map(|(x,w)| x*w).sum::<f64>()); loss -= target * p.max(1e-9).ln() + (1.0-target) * (1.0-p).max(1e-9).ln(); if (p >= 0.5) == sample.success { correct += 1; } }
    let count = samples.len(); println!("{}", serde_json::to_string(&Reply { weights, bias, probability: None, loss: Some(if count == 0 { 0.0 } else { loss / count as f64 }), accuracy: Some(if count == 0 { 0.0 } else { correct as f64 / count as f64 }), samples: count }).unwrap());
}
