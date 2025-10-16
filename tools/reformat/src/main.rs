use std::{
	fs::File,
	io::{BufReader, BufWriter},
};

use clap::Parser;
use serde_json::{Map, Value, from_reader, json};

#[derive(Parser)]
struct Args {
	in_path: String,
	out_path: String,
}

fn main() {
	// Parse input and output paths.
	let Args { in_path, out_path } = Args::parse();

	// Read the existing samples file.
	let in_file = File::open(in_path).unwrap();
	let reader = BufReader::new(in_file);
	let samples: Value = from_reader(reader).unwrap();

	// Reformat the samples.
	let value = reformat_samples(samples);

	// Write the new file.
	let out_file = File::create(out_path).unwrap();
	let writer = BufWriter::new(out_file);
	serde_json::to_writer_pretty(writer, &value).unwrap();
}

fn reformat_samples(samples: Value) -> Value {
	let Value::Object(samples) = samples else {
		panic!("samples must be an object");
	};

	// While reformatting samples, move the sample names from outer object keys
	// to fields within the sample objects themselves.
	let samples: Value = samples.into_values().map(reformat_sample).collect();

	// Tuck the existing outer object under "samples", and version the format.
	json!({
		"format": "v1",
		"samples": samples,
	})
}

fn reformat_sample(sample: Value) -> Value {
	let Value::Object(mut sample) = sample else {
		panic!("sample must be an object");
	};

	// Move struct-of-array style fields into individual sample objects.
	let Some(Value::Array(labels)) = sample.get("tileLabels").cloned() else {
		panic!("sample must contain tile labels array");
	};
	let Value::Array(angle_sets) = sample
		.get("tileSetRotationAngles")
		.unwrap_or(&Value::Array(Vec::new()))
		.clone()
	else {
		panic!("tile set rotation angles must be an array");
	};
	let Value::Array(periods) = sample
		.get("tileSetRotationAngleRepeat")
		.unwrap_or(&Value::Array(Vec::new()))
		.clone()
	else {
		panic!("tile set rotation angle repeat must be an array");
	};

	let Some(Value::Array(tile_sets)) = sample.remove("tileSets") else {
		panic!();
	};
	let tile_sets = tile_sets
		.into_iter()
		.enumerate()
		.map(|(i, tile_set)| {
			// Tile sets are currently allowed to be either a URI or an array of
			// URIs. Convert them uniformly to an array of objects, each of
			// which has explicit an URI and (optionally) angle.
			let mut images: Vec<Map<String, Value>> = match tile_set {
				uri @ Value::String(..) => {
					vec![Map::from_iter([("uri".into(), uri)])]
				}
				Value::Array(uris) => uris
					.into_iter()
					.map(|uri| Map::from_iter([("uri".into(), uri)]))
					.collect(),
				_ => panic!("unexpected tile set type at index {i}"),
			};
			if let Some(angles) = angle_sets.get(i) {
				for (j, image) in images.iter_mut().enumerate() {
					if let Some(angle) = angles.get(j)
						&& angle.is_number()
					{
						image.insert("angleDegrees".into(), angle.clone());
					}
				}
			}

			let mut tile_set =
				Map::from_iter([("label".into(), labels[i].clone())]);
			if let Some(period @ Value::Number(..)) = periods.get(i) {
				tile_set.insert("periodDegrees".into(), period.clone());
			}
			tile_set.insert("tiles".into(), images.into());
			tile_set
		})
		.collect();
	sample.insert("tileSets".into(), tile_sets);

	// Remove migrated and unused fields.
	sample.shift_remove("tileLabels");
	sample.shift_remove("tileSetRotationAngles");
	sample.shift_remove("tileSetRotationSpacing");
	sample.shift_remove("tileSetRotationAngleRepeat");
	sample.shift_remove("tileSetRotation");
	sample.shift_remove("unit");
	sample.shift_remove("pixelsPerUnit");

	Value::Object(sample)
}
