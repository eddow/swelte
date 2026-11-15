module main

import json
import os
import stbi

#pkgconfig libwebp
#include <webp/encode.h>

fn C.WebPEncodeRGBA(&u8, int, int, int, f32, &&u8) usize
fn C.WebPFree(voidptr)
fn C.stbi_info(&char, &int, &int, &int) int

struct ImageInput {
	src     string
	file    string
	key     string
	widths  []int
	quality int
}

struct ImageVariant {
pub:
	src    string
	width  int
	height int
	format string = 'webp'
}

fn convert(input ImageInput, directory string) ![]ImageVariant {
	mut width := 0
	mut height := 0
	mut channels := 0
	if C.stbi_info(input.file.str, &width, &height, &channels) == 0 || width < 1 || height < 1
		|| i64(width) * height > 64000000 {
		return error('unsupported or oversized input: ' + input.src)
	}
	image := stbi.load(input.file)!
	defer { image.free() }
	mut output := []ImageVariant{}
	mut seen := map[int]bool{}
	for requested in input.widths {
		w := if requested > image.width { image.width } else { requested }
		if seen[w] { continue
		 }
		seen[w] = true
		h := int(f64(image.height) * f64(w) / f64(image.width) + 0.5)
		target_height := if h < 1 { 1 } else { h }
		resized := stbi.resize_uint8(&image, w, target_height)!
		mut bytes := &u8(unsafe { nil })
		length := C.WebPEncodeRGBA(resized.data, w, target_height, w * 4, f32(input.quality),
			&bytes)
		resized.free()
		if length == 0 { return error('WebP encoding failed: ' + input.src) }
		file := input.key + '-' + w.str() + '.webp'
		os.write_bytes(directory + '/' + file, unsafe { bytes.vbytes(int(length)) }) or {
			C.WebPFree(bytes)
			return err
		}
		C.WebPFree(bytes)
		output << ImageVariant{
			src:    file
			width:  w
			height: target_height
		}
	}
	return output
}

fn main() {
	if os.args.len != 3 {
		eprintln('usage: images input.json output-directory')
		exit(1)
	}
	raw := os.read_file(os.args[1]) or { panic(err) }
	inputs := json.decode([]ImageInput, raw) or { panic(err) }
	os.mkdir_all(os.args[2]) or { panic(err) }
	mut manifest := map[string][]ImageVariant{}
	for input in inputs {
		manifest[input.src] = convert(input, os.args[2]) or { panic(err) }
	}
	println(json.encode(manifest))
}
