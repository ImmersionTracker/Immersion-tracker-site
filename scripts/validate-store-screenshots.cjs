const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const directory = path.resolve(__dirname, "../store-assets/output");
const expected = [
  "01-popup-video-playing.png",
  "02-popup-japanese-detected.png",
  "03-daily-weekly-statistics.png",
  "04-history-analytics.png",
  "05-settings.png"
];

function paeth(a, b, c) {
  const value = a + b - c;
  const pa = Math.abs(value - a);
  const pb = Math.abs(value - b);
  const pc = Math.abs(value - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(file) {
  const buffer = fs.readFileSync(file);
  if (!buffer.subarray(1, 4).equals(Buffer.from("PNG"))) throw new Error(`${path.basename(file)} is not a PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(`${path.basename(file)} uses an unsupported PNG format for border validation`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0, input = 0; y < height; y += 1) {
    const filter = inflated[input++];
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[input++];
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y ? pixels[previous + x] : 0;
      const upperLeft = y && x >= channels ? pixels[previous + x - channels] : 0;
      const value = filter === 0 ? raw
        : filter === 1 ? raw + left
        : filter === 2 ? raw + up
        : filter === 3 ? raw + Math.floor((left + up) / 2)
        : filter === 4 ? raw + paeth(left, up, upperLeft)
        : NaN;
      if (!Number.isFinite(value)) throw new Error(`${path.basename(file)} has an unknown PNG filter`);
      pixels[row + x] = value & 255;
    }
  }
  return { width, height, channels, pixels };
}

function whiteRatio(image, left, top, right, bottom) {
  let white = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * image.width + x) * image.channels;
      const alpha = image.channels === 4 ? image.pixels[index + 3] : 255;
      if (alpha > 245 && image.pixels[index] > 245 && image.pixels[index + 1] > 245 && image.pixels[index + 2] > 245) white += 1;
      count += 1;
    }
  }
  return count ? white / count : 0;
}

function validateNoWhiteFrame(image, name) {
  const strip = 20;
  const ratios = {
    top: whiteRatio(image, 0, 0, image.width, strip),
    bottom: whiteRatio(image, 0, image.height - strip, image.width, image.height),
    left: whiteRatio(image, 0, 0, strip, image.height),
    right: whiteRatio(image, image.width - strip, 0, image.width, image.height)
  };
  const opposingWhiteFrame = (ratios.left > .985 && ratios.right > .985) ||
    (ratios.top > .985 && ratios.bottom > .985);
  const corner = 36;
  const whiteCorners = [
    whiteRatio(image, 0, 0, corner, corner),
    whiteRatio(image, image.width - corner, 0, image.width, corner),
    whiteRatio(image, 0, image.height - corner, corner, image.height),
    whiteRatio(image, image.width - corner, image.height - corner, image.width, image.height)
  ].filter(value => value > .995).length;
  if (opposingWhiteFrame || whiteCorners >= 3) {
    throw new Error(`${name} appears to contain an unused white canvas border`);
  }
}

const actual = fs.readdirSync(directory).filter(file => file.endsWith(".png")).sort();
assertFileSet: {
  if (actual.length !== expected.length || expected.some(file => !actual.includes(file))) {
    throw new Error(`Expected exactly these five PNGs: ${expected.join(", ")}`);
  }
}
for (const name of expected) {
  const image = decodePng(path.join(directory, name));
  if (image.width !== 1280 || image.height !== 800) throw new Error(`${name} is ${image.width}x${image.height}`);
  validateNoWhiteFrame(image, name);
  console.log(`✓ ${name}: ${image.width}x${image.height}, no white frame`);
}
