import React, { useEffect, useRef, useState, useCallback } from "react";

/* ------------------------------------------------------------------ *
 * PipelineLab
 *
 * Demonstrates that every photograph is tuned, by running the imaging
 * pipeline backwards (Unbuild) and by running historical emulsions
 * forwards (Film).
 *
 * All processing is WebGL2, RGBA32F end to end. No quantisation between
 * stages. Input from a JPEG is 8-bit, so float buys you no new
 * information there -- only no ADDED loss. Load a 16-bit PNG and the
 * depth is real; there is a hand-rolled decoder below for that, because
 * createImageBitmap truncates to 8 bits.
 * ------------------------------------------------------------------ */

const VERT = `#version 300 es
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_LINEARIZE = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outC;
uniform sampler2D uSrc;
vec3 s2l(vec3 c){
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
void main(){
  vec2 uv = vec2(vUV.x, 1.0 - vUV.y);
  outC = vec4(s2l(clamp(texture(uSrc, uv).rgb, 0.0, 1.0)), 1.0);
}`;

const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outC;
uniform sampler2D uTex; uniform float uThresh; uniform float uExp;
void main(){
  vec3 c = texture(uTex, vUV).rgb * uExp;
  float l = dot(c, vec3(0.3, 0.6, 0.1));
  outC = vec4(vec3(max(0.0, l - uThresh)), 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outC;
uniform sampler2D uTex; uniform vec2 uStep;
const float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;
void main(){
  vec3 s = texture(uTex, vUV).rgb * w0;
  s += texture(uTex, vUV + uStep * 1.0).rgb * w1;
  s += texture(uTex, vUV - uStep * 1.0).rgb * w1;
  s += texture(uTex, vUV + uStep * 2.0).rgb * w2;
  s += texture(uTex, vUV - uStep * 2.0).rgb * w2;
  s += texture(uTex, vUV + uStep * 3.0).rgb * w3;
  s += texture(uTex, vUV - uStep * 3.0).rgb * w3;
  s += texture(uTex, vUV + uStep * 4.0).rgb * w4;
  s += texture(uTex, vUV - uStep * 4.0).rgb * w4;
  outC = vec4(s, 1.0);
}`;

/* 4x4 tap box sample into a small target -- used for the readout and for
 * the lab auto-balance mean. An autoprinter integrated the whole negative
 * through a diffuser onto a photocell, so a blurred average is the
 * historically faithful way to compute this. */
const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outC;
uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uBin;
void main(){
  vec3 s = vec3(0.0);
  for (int j = 0; j < 4; j++){
    for (int i = 0; i < 4; i++){
      vec2 o = (vec2(float(i), float(j)) + 0.5) * 0.25 * uBin * uTexel;
      s += texture(uTex, vUV + o - 0.5 * uBin * uTexel).rgb;
    }
  }
  outC = vec4(s / 16.0, 1.0);
}`;

const FS_MAIN = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outC;

uniform sampler2D uLin;
uniform sampler2D uHal;
uniform int   uMode;      // 0 = unbuild, 1 = film
uniform int   uStage;     // unbuild stage 0..5
uniform int   uStock;     // film stock 0..5
uniform float uExp;
uniform vec3  uLabGain;
uniform int   uLab;
uniform float uGrain;
uniform float uHalAmt;
uniform vec2  uSize;
uniform float uPixScale;  // source px per output px; 1.0 at full resolution

vec3 l2s(vec3 c){
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
float hash(vec2 p){
  p = fract(p * vec2(443.8975, 397.2973));
  p += dot(p.xy, p.yx + 19.19);
  return fract(p.x * p.y);
}
float sigm(float z){ return 1.0 / (1.0 + exp(-z)); }
float hd(float v, float c, float p){
  float a = sigm((0.0 - p) * c * 4.0), b = sigm((1.0 - p) * c * 4.0);
  return clamp((sigm((v - p) * c * 4.0) - a) / (b - a), 0.0, 1.0);
}

void stockParams(int s, out vec3 wb, out vec3 ct, out vec3 pv,
                 out float sat, out float lift, out float gn, out float hl,
                 out vec3 mono, out int isMono){
  wb = vec3(1.0); ct = vec3(2.0); pv = vec3(0.45);
  sat = 1.0; lift = 0.0; gn = 0.4; hl = 0.3;
  mono = vec3(0.3, 0.6, 0.1); isMono = 0;
  if (s == 1){ isMono = 1; mono = vec3(0.02, 0.22, 0.96); ct = vec3(3.2); pv = vec3(0.48); gn = 0.5;  hl = 0.15; }
  else if (s == 2){ isMono = 1; mono = vec3(0.28, 0.48, 0.24); ct = vec3(2.7); pv = vec3(0.45); gn = 1.0; hl = 0.25; }
  else if (s == 3){ wb = vec3(1.07, 1.0, 0.93); sat = 0.80; ct = vec3(1.90, 1.85, 1.75); pv = vec3(0.44, 0.45, 0.46); lift = 0.11; gn = 0.32; hl = 0.35; }
  else if (s == 4){ wb = vec3(1.02, 1.0, 1.04); sat = 1.50; ct = vec3(2.90, 3.00, 3.40); pv = vec3(0.47, 0.47, 0.50); lift = 0.0;  gn = 0.16; hl = 0.20; }
  else if (s == 5){ wb = vec3(0.64, 1.0, 1.66); sat = 0.95; ct = vec3(2.20, 2.20, 2.30); pv = vec3(0.45, 0.45, 0.47); lift = 0.06; gn = 0.50; hl = 1.50; }
}

void main(){
  vec3 c = texture(uLin, vUV).rgb * uExp;
  if (uLab == 1) c *= uLabGain;
  vec2 px = gl_FragCoord.xy;

  if (uMode == 0){
    if (uStage == 0){ outC = vec4(l2s(c), 1.0); return; }

    /* inverse colour correction matrix -- camera-native primaries */
    if (uStage >= 2){
      c = vec3(
        0.62 * c.r + 0.28 * c.g + 0.10 * c.b,
        0.14 * c.r + 0.72 * c.g + 0.14 * c.b,
        0.10 * c.r + 0.34 * c.g + 0.56 * c.b);
    }
    /* inverse white balance gains */
    if (uStage >= 3) c /= vec3(2.1, 1.0, 1.55);

    if (uStage == 4){
      bool er = mod(px.y, 2.0) < 1.0;
      bool ec = mod(px.x, 2.0) < 1.0;
      float v = er ? (ec ? c.r : c.g) : (ec ? c.g : c.b);
      vec2 d = (px - uSize * 0.5) / length(uSize * 0.5);
      v *= 1.0 - 0.42 * dot(d, d);                        /* lens shading   */
      float n1 = hash(px) - 0.5, n2 = hash(px + 37.0) - 0.5;
      v += n1 * 0.012;                                     /* read noise     */
      v += sqrt(max(v, 0.0)) * n2 * 0.045;                 /* shot noise     */
      v += 0.016;                                          /* black pedestal */
      outC = vec4(vec3(v), 1.0); return;
    }
    if (uStage == 5){
      float nir = max(0.0, c.g - (c.r + c.b) * 0.42) * 2.6 + max(0.0, c.r - c.b * 0.8) * 0.9;
      float v = (c.r + c.g + c.b) / 3.0 * 0.62 + nir * 0.38;
      outC = vec4(vec3(v), 1.0); return;
    }
    outC = vec4(c, 1.0); return;   /* stages 1-3 display LINEAR, on purpose */
  }

  if (uStock == 0){ outC = vec4(l2s(c), 1.0); return; }

  vec3 wb, ct, pv, mono; float sat, lift, gn, hl; int isMono;
  stockParams(uStock, wb, ct, pv, sat, lift, gn, hl, mono, isMono);
  c *= wb;

  vec3 v;
  if (isMono == 1){
    float m = pow(max(dot(c, mono), 0.0), 1.0 / 2.2);
    v = vec3(hd(m, ct.x, pv.x));
  } else {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = lum + (c - lum) * sat;
    v = vec3(hd(pow(max(c.r, 0.0), 1.0 / 2.2), ct.x, pv.x),
             hd(pow(max(c.g, 0.0), 1.0 / 2.2), ct.y, pv.y),
             hd(pow(max(c.b, 0.0), 1.0 / 2.2), ct.z, pv.z));
    v += lift * (1.0 - v) * (1.0 - v);
  }

  float h = texture(uHal, vUV).r * hl * uHalAmt;
  v += h * vec3(1.0, 0.28, 0.16);

  if (uGrain > 0.0){
    vec2 gp = floor(px / max(uPixScale, 1.0));
    float n = hash(gp) - 0.5;
    float mid = v.g * (1.0 - v.g) * 4.0;
    v += n * gn * uGrain * 0.16 * pow(max(mid, 0.0), 0.55);
  }
  outC = vec4(v, 1.0);
}`;

const FS_BLIT = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outC;
uniform sampler2D uTex; uniform float uDither;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  outC = vec4(clamp(c + d * uDither / 255.0, 0.0, 1.0), 1.0);
}`;

/* ---------------------------- PNG 16-bit ---------------------------- */

const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlibDeflate(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function zlibInflate(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function encodePNG16(w, h, rgb) {
  const stride = w * 6;
  const raw = new Uint8Array(h * (1 + stride));
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) {
        const u = Math.round(Math.min(1, Math.max(0, rgb[i + k])) * 65535);
        raw[p++] = (u >> 8) & 255;
        raw[p++] = u & 255;
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 16;
  ihdr[9] = 2;
  const idat = await zlibDeflate(raw);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const q of parts) { out.set(q, o); o += q.length; }
  return new Blob([out], { type: "image/png" });
}

/* Returns {w,h,data:Float32Array RGBA 0..1} for 16-bit non-interlaced PNG,
 * or null if this is not one (caller falls back to createImageBitmap). */
async function decodePNG16(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  if (u8.length < 8 || dv.getUint32(0) !== 0x89504e47) return null;
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (p + 8 <= u8.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    if (type === "IHDR") {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
      bd = u8[p + 16]; ct = u8[p + 17];
      if (u8[p + 20] !== 0) return null;
    } else if (type === "IDAT") {
      idat.push(u8.slice(p + 8, p + 8 + len));
    } else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bd !== 16) return null;
  const ch = ct === 0 ? 1 : ct === 2 ? 3 : ct === 4 ? 2 : ct === 6 ? 4 : 0;
  if (!ch) return null;

  let total = 0;
  for (const d of idat) total += d.length;
  const comp = new Uint8Array(total);
  let o = 0;
  for (const d of idat) { comp.set(d, o); o += d.length; }
  const inf = await zlibInflate(comp);

  const bpp = ch * 2, stride = w * bpp;
  const out = new Uint8Array(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = inf[q++];
    const row = y * stride, prow = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[row + i - bpp] : 0;
      const b = y > 0 ? out[prow + i] : 0;
      const c = y > 0 && i >= bpp ? out[prow + i - bpp] : 0;
      let v = inf[q + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[row + i] = v & 255;
    }
    q += stride;
  }

  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * bpp;
    const g = (k) => ((out[s + k * 2] << 8) | out[s + k * 2 + 1]) / 65535;
    if (ch === 1) { const v = g(0); data.set([v, v, v, 1], i * 4); }
    else if (ch === 2) { const v = g(0); data.set([v, v, v, g(1)], i * 4); }
    else if (ch === 3) data.set([g(0), g(1), g(2), 1], i * 4);
    else data.set([g(0), g(1), g(2), g(3)], i * 4);
  }
  return { w, h, data };
}

/* ------------------------------ GL utils ------------------------------ */

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
  }
  return s;
}

function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "link failed");
  }
  return p;
}

function makeTarget(gl, w, h, internal) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

const UNBUILD = [
  ["As delivered", "The finished file. Everything below is applied on top of an image that was already processed once."],
  ["Linear light", "Transfer function removed. Values proportional to scene radiance. Black because human brightness response is a power law. Nothing lost -- lift exposure."],
  ["Camera-native colour", "Inverse CCM. The CFA response does not match the cone fundamentals; the matrix that corrects it is fitted, not derived."],
  ["No white balance", "Gains removed. Green dominates: half the Bayer array is green and silicon peaks there. There is no illuminant-independent true colour."],
  ["Bayer raw", "RGGB mosaic, black pedestal, read and shot noise, lens shading. Only physically meaningful at full resolution."],
  ["Radiometric", "Unweighted scalar radiance. No V(lambda), no colour. The NIR response is fabricated -- the file has no spectrum left."],
];

const STOCKS = [
  ["Unprocessed", "Reference. Re-encoded straight back to sRGB."],
  ["Ortho, c.1905", "Blue and UV sensitive, effectively red-blind. Skies blow out, red lips go black. A sensitivity curve, not a filter."],
  ["Tri-X 400", "Panchromatic but still more blue-sensitive than the eye. Panchromatic meant not red-blind, never matching V(lambda)."],
  ["Portra 400", "Engineered around skin. Low saturation, long shoulder, lifted toe. A product decision about what a face should look like."],
  ["Velvia 50", "Sold on oversaturation. Steep curve, ~5 stops latitude, shadows dumped toward cyan. A saturation filter in a canister."],
  ["CineStill 800T", "Vision3 with the remjet anti-halation backing stripped. A suppressed defect reintroduced and sold as the feature."],
];

export default function PipelineLab() {
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const srcRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [img, setImg] = useState(null);
  const [mode, setMode] = useState(0);
  const [stage, setStage] = useState(0);
  const [stock, setStock] = useState(1);
  const [full, setFull] = useState(false);
  const [ev, setEv] = useState(0);
  const [grain, setGrain] = useState(1);
  const [halation, setHalation] = useState(1);
  const [lab, setLab] = useState(false);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);

  /* ---- context + programs ---- */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const gl = cv.getContext("webgl2", {
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) { setErr("WebGL2 unavailable in this browser."); return; }
    const extF = gl.getExtension("EXT_color_buffer_float");
    const extH = gl.getExtension("EXT_color_buffer_half_float");
    if (!extF && !extH) { setErr("No float render targets (EXT_color_buffer_float)."); return; }
    const fmt = extF ? gl.RGBA32F : gl.RGBA16F;
    try {
      glRef.current = {
        gl, fmt,
        float32: !!extF,
        vao: gl.createVertexArray(),
        pLin: program(gl, FS_LINEARIZE),
        pBright: program(gl, FS_BRIGHT),
        pBlur: program(gl, FS_BLUR),
        pDown: program(gl, FS_DOWN),
        pMain: program(gl, FS_MAIN),
        pBlit: program(gl, FS_BLIT),
        t: {},
        maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      };
      if (!extF) setNote("Half-float fallback: RGBA16F targets, not RGBA32F.");
      setReady(true);
    } catch (e) { setErr(String(e.message || e)); }
  }, []);

  /* ---- (re)build textures when image or resolution changes ---- */
  const build = useCallback(() => {
    const G = glRef.current, S = srcRef.current;
    if (!G || !S) return;
    const { gl, fmt } = G;
    const cap = full ? G.maxTex : 1400;
    const scale = Math.min(1, cap / Math.max(S.w, S.h));
    const w = Math.max(1, Math.round(S.w * scale));
    const h = Math.max(1, Math.round(S.h * scale));

    Object.values(G.t).forEach((t) => {
      if (t && t.tex) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    });
    G.t = {};

    if (G.srcTex) gl.deleteTexture(G.srcTex);
    const st = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, st);
    if (S.data) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, S.w, S.h, 0, gl.RGBA, gl.FLOAT, S.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, S.bitmap);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    G.srcTex = st;

    G.t.lin = makeTarget(gl, w, h, fmt);
    G.t.a = makeTarget(gl, w, h, fmt);
    G.t.b = makeTarget(gl, w, h, fmt);
    G.t.out = makeTarget(gl, w, h, fmt);
    G.t.mean = makeTarget(gl, 96, 96, fmt);
    G.t.small = makeTarget(gl, 96, 96, fmt);
    G.w = w; G.h = h;
    G.srcScale = scale;

    const cv = canvasRef.current;
    cv.width = w; cv.height = h;

    /* linearize once */
    gl.bindVertexArray(G.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.t.lin.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(G.pLin);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st);
    gl.uniform1i(gl.getUniformLocation(G.pLin, "uSrc"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* integrated mean, as an autoprinter photocell would see it */
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.t.mean.fbo);
    gl.viewport(0, 0, 96, 96);
    gl.useProgram(G.pDown);
    gl.bindTexture(gl.TEXTURE_2D, G.t.lin.tex);
    gl.uniform1i(gl.getUniformLocation(G.pDown, "uTex"), 0);
    gl.uniform2f(gl.getUniformLocation(G.pDown, "uTexel"), 1 / w, 1 / h);
    gl.uniform2f(gl.getUniformLocation(G.pDown, "uBin"), w / 96, h / 96);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const buf = new Float32Array(96 * 96 * 4);
    gl.readPixels(0, 0, 96, 96, gl.RGBA, gl.FLOAT, buf);
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < 96 * 96; i++) { mr += buf[i * 4]; mg += buf[i * 4 + 1]; mb += buf[i * 4 + 2]; }
    const n = 96 * 96;
    G.mean = [mr / n, mg / n, mb / n];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }, [full]);

  /* ---- draw ---- */
  const draw = useCallback(() => {
    const G = glRef.current;
    if (!G || !G.t.lin) return;
    const { gl } = G;
    const w = G.w, h = G.h;
    const exposure = Math.pow(2, ev);
    gl.bindVertexArray(G.vao);
    gl.disable(gl.BLEND);

    /* halation: threshold then separable gaussian, ping-pong */
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.t.a.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(G.pBright);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, G.t.lin.tex);
    gl.uniform1i(gl.getUniformLocation(G.pBright, "uTex"), 0);
    gl.uniform1f(gl.getUniformLocation(G.pBright, "uThresh"), 0.62);
    gl.uniform1f(gl.getUniformLocation(G.pBright, "uExp"), exposure);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const passes = Math.max(2, Math.round(4 * Math.max(1, w / 900)));
    const rad = Math.max(1, w / 260);
    gl.useProgram(G.pBlur);
    const uT = gl.getUniformLocation(G.pBlur, "uTex");
    const uS = gl.getUniformLocation(G.pBlur, "uStep");
    let from = G.t.a, to = G.t.b;
    for (let i = 0; i < passes; i++) {
      for (const dir of [[rad / w, 0], [0, rad / h]]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform1i(uT, 0);
        gl.uniform2f(uS, dir[0], dir[1]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const t = from; from = to; to = t;
      }
    }

    /* main chain into a float target */
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.t.out.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(G.pMain);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, G.t.lin.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    const U = (k) => gl.getUniformLocation(G.pMain, k);
    gl.uniform1i(U("uLin"), 0);
    gl.uniform1i(U("uHal"), 1);
    gl.uniform1i(U("uMode"), mode);
    gl.uniform1i(U("uStage"), stage);
    gl.uniform1i(U("uStock"), stock);
    gl.uniform1f(U("uExp"), exposure);
    gl.uniform1i(U("uLab"), lab ? 1 : 0);
    const m = G.mean || [1, 1, 1];
    gl.uniform3f(U("uLabGain"),
      m[0] > 1e-5 ? 0.18 / (m[0] * exposure) : 1,
      m[1] > 1e-5 ? 0.18 / (m[1] * exposure) : 1,
      m[2] > 1e-5 ? 0.18 / (m[2] * exposure) : 1);
    gl.uniform1f(U("uGrain"), grain);
    gl.uniform1f(U("uHalAmt"), halation);
    gl.uniform2f(U("uSize"), w, h);
    gl.uniform1f(U("uPixScale"), 1 / Math.max(G.srcScale, 1e-6));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* readout sample */
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.t.small.fbo);
    gl.viewport(0, 0, 96, 96);
    gl.useProgram(G.pDown);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, G.t.out.tex);
    gl.uniform1i(gl.getUniformLocation(G.pDown, "uTex"), 0);
    gl.uniform2f(gl.getUniformLocation(G.pDown, "uTexel"), 1 / w, 1 / h);
    gl.uniform2f(gl.getUniformLocation(G.pDown, "uBin"), w / 96, h / 96);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const s = new Float32Array(96 * 96 * 4);
    gl.readPixels(0, 0, 96, 96, gl.RGBA, gl.FLOAT, s);
    let acc = [0, 0, 0], lo = 1e9, hi = -1e9, clipLo = 0, clipHi = 0;
    for (let i = 0; i < 96 * 96; i++) {
      for (let k = 0; k < 3; k++) {
        const v = s[i * 4 + k];
        acc[k] += v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (v <= 0.0005) clipLo++;
        if (v >= 0.9995) clipHi++;
      }
    }
    const tot = 96 * 96 * 3;
    setStats({
      r: acc[0] / (96 * 96), g: acc[1] / (96 * 96), b: acc[2] / (96 * 96),
      lo, hi, clipLo: (clipLo / tot) * 100, clipHi: (clipHi / tot) * 100,
    });

    /* blit to canvas */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(G.pBlit);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, G.t.out.tex);
    gl.uniform1i(gl.getUniformLocation(G.pBlit, "uTex"), 0);
    gl.uniform1f(gl.getUniformLocation(G.pBlit, "uDither"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }, [mode, stage, stock, ev, grain, halation, lab]);

  useEffect(() => { if (ready && img) { build(); draw(); } }, [ready, img, full, build]);
  useEffect(() => { if (ready && img) draw(); }, [draw, ready, img]);

  /* ---- load ---- */
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBusy(true); setNote("");
    try {
      const buf = await f.arrayBuffer();
      let dec = null;
      try { dec = await decodePNG16(buf); } catch { dec = null; }
      if (dec) {
        srcRef.current = { w: dec.w, h: dec.h, data: dec.data, bits: 16 };
        setNote("16-bit PNG decoded manually. Depth is real, not padded.");
      } else {
        const bm = await createImageBitmap(new Blob([buf]));
        srcRef.current = { w: bm.width, h: bm.height, bitmap: bm, bits: 8 };
        setNote("8-bit source. Float chain adds no information, only avoids further loss.");
      }
      setImg({ n: Date.now(), w: srcRef.current.w, h: srcRef.current.h, bits: srcRef.current.bits });
    } catch (ex) {
      setErr("Could not decode: " + (ex.message || ex));
    }
    setBusy(false);
  };

  const readFloat = () => {
    const G = glRef.current;
    const { gl } = G, w = G.w, h = G.h;
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.t.out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const rgb = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((h - 1 - y) * w + x) * 4, d = (y * w + x) * 3;
        rgb[d] = px[s]; rgb[d + 1] = px[s + 1]; rgb[d + 2] = px[s + 2];
      }
    }
    return { w, h, rgb };
  };

  const save = (blob, name) => {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  };

  const export16 = async () => {
    setBusy(true);
    try {
      const { w, h, rgb } = readFloat();
      save(await encodePNG16(w, h, rgb), `pipeline_${w}x${h}_16bit.png`);
    } catch (ex) { setErr(String(ex.message || ex)); }
    setBusy(false);
  };

  const export8 = () => {
    draw();
    canvasRef.current.toBlob((b) => save(b, "pipeline_8bit.png"), "image/png");
  };

  const css = `
  .pl{--ink:#e9e7e2;--dim:#8d9096;--rule:#2b2d31;--panel:#000000;--live:#d6a03c;
      background:var(--panel);color:var(--ink);font:14px/1.55 system-ui,-apple-system,sans-serif;
      padding:20px;min-height:100vh;box-sizing:border-box}
  .pl *{box-sizing:border-box}
  .pl h1{font:500 15px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;
      text-transform:uppercase;margin:0 0 4px}
  .pl .sub{color:var(--dim);font-size:13px;margin:0 0 18px;max-width:62ch}
  .pl .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .pl .lbl{font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;
      text-transform:uppercase;color:var(--dim);margin:20px 0 8px}
  .pl .surround{display:flex;justify-content:center;margin:2px 0}
  .pl canvas{max-width:100%;height:auto;display:block;image-rendering:auto}
  .pl .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px}
  .pl button{font:500 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;
      background:transparent;color:var(--ink);border:1px solid var(--rule);padding:10px 8px;
      border-radius:2px;cursor:pointer;text-align:left}
  .pl button:hover{border-color:#4a4d52}
  .pl button[data-on="1"]{border-color:var(--live);color:var(--live)}
  .pl button:focus-visible{outline:2px solid var(--live);outline-offset:2px}
  .pl .row{display:flex;align-items:center;gap:12px;margin:9px 0}
  .pl .row label{flex:0 0 86px;font-size:12px;color:var(--dim)}
  .pl input[type=range]{flex:1;accent-color:var(--live)}
  .pl .val{flex:0 0 62px;text-align:right;font-family:ui-monospace,Menlo,monospace;font-size:12px}
  .pl .cap{color:var(--dim);font-size:13px;margin:10px 0 0;max-width:70ch;min-height:3em}
  .pl .read{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:1px;
      background:var(--rule);border:1px solid var(--rule);margin-top:14px}
  .pl .read div{background:var(--panel);padding:8px 10px}
  .pl .read span{display:block;font-size:10px;letter-spacing:.14em;color:var(--dim);
      text-transform:uppercase;font-family:ui-monospace,Menlo,monospace}
  .pl .read b{font-weight:500;font-family:ui-monospace,Menlo,monospace;font-size:13px}
  .pl .warn{color:var(--live);font-size:12px;font-family:ui-monospace,Menlo,monospace;margin-top:10px}
  @media (prefers-reduced-motion:reduce){.pl *{transition:none!important}}`;

  const S = mode === 0 ? UNBUILD : STOCKS;
  const sel = mode === 0 ? stage : stock;
  const setSel = mode === 0 ? setStage : setStock;

  return (
    <div className="pl">
      <style>{css}</style>
      <h1>Pipeline lab</h1>
      <p className="sub">
        Every photograph is tuned. Run the pipeline backwards, or run historical
        emulsions forwards. RGBA32F throughout, no quantisation between stages.
        Nothing leaves this device.
      </p>

      {err && <p className="warn">{err}</p>}

      <div className="grid" style={{ marginBottom: 14 }}>
        <button onClick={() => document.getElementById("pl-file").click()}>
          {img ? "Load another" : "Load an image"}
        </button>
        <button data-on={full ? 1 : 0} onClick={() => setFull(!full)}>
          {full ? "Full resolution" : "Preview (1400px)"}
        </button>
        <button onClick={export8} disabled={!img}>Export 8-bit PNG</button>
        <button onClick={export16} disabled={!img}>Export 16-bit PNG</button>
      </div>
      <input id="pl-file" type="file" accept="image/*,.png" onChange={onFile} style={{ display: "none" }} />

      <div className="surround">
        <canvas ref={canvasRef} aria-label="Processed image output" />
      </div>

      <div className="lbl">Direction</div>
      <div className="grid">
        <button data-on={mode === 0 ? 1 : 0} onClick={() => setMode(0)}>Unbuild the pipeline</button>
        <button data-on={mode === 1 ? 1 : 0} onClick={() => setMode(1)}>Apply an emulsion</button>
      </div>

      <div className="lbl">{mode === 0 ? "Stage" : "Stock"}</div>
      <div className="grid">
        {S.map(([n], i) => (
          <button key={n} data-on={sel === i ? 1 : 0} onClick={() => setSel(i)}>
            {mode === 0 ? `${i} · ${n}` : n}
          </button>
        ))}
      </div>
      <p className="cap">{S[sel][1]}</p>

      <div className="lbl">Controls</div>
      <div className="row">
        <label htmlFor="pl-ev">Exposure</label>
        <input id="pl-ev" type="range" min="-3" max="7" step="0.1" value={ev}
          onChange={(e) => setEv(+e.target.value)} />
        <span className="val">{ev.toFixed(1)} EV</span>
      </div>
      <div className="row">
        <label htmlFor="pl-gr">Grain</label>
        <input id="pl-gr" type="range" min="0" max="2" step="0.01" value={grain}
          onChange={(e) => setGrain(+e.target.value)} />
        <span className="val">{grain.toFixed(2)}</span>
      </div>
      <div className="row">
        <label htmlFor="pl-ha">Halation</label>
        <input id="pl-ha" type="range" min="0" max="2.5" step="0.01" value={halation}
          onChange={(e) => setHalation(+e.target.value)} />
        <span className="val">{halation.toFixed(2)}</span>
      </div>
      <div className="grid" style={{ marginTop: 10 }}>
        <button data-on={lab ? 1 : 0} onClick={() => setLab(!lab)}>
          Lab auto-balance: {lab ? "on" : "off"}
        </button>
      </div>

      {stats && (
        <div className="read">
          <div><span>Source</span><b>{img ? `${img.w}×${img.h}` : "--"}</b></div>
          <div><span>Working</span><b>{glRef.current ? `${glRef.current.w}×${glRef.current.h}` : "--"}</b></div>
          <div><span>Input bits</span><b>{img ? img.bits : "--"}</b></div>
          <div><span>Target</span><b>{glRef.current && glRef.current.float32 ? "RGBA32F" : "RGBA16F"}</b></div>
          <div><span>Mean R</span><b>{stats.r.toFixed(4)}</b></div>
          <div><span>Mean G</span><b>{stats.g.toFixed(4)}</b></div>
          <div><span>Mean B</span><b>{stats.b.toFixed(4)}</b></div>
          <div><span>Range</span><b>{stats.lo.toFixed(3)}–{stats.hi.toFixed(3)}</b></div>
          <div><span>Clip low</span><b>{stats.clipLo.toFixed(1)}%</b></div>
          <div><span>Clip high</span><b>{stats.clipHi.toFixed(1)}%</b></div>
        </div>
      )}

      {note && <p className="warn">{note}</p>}
      {busy && <p className="warn">Working…</p>}
      {!full && (
        <p className="warn">
          Bayer mosaic and grain are pixel-locked. Switch to full resolution for physically meaningful output.
        </p>
      )}
    </div>
  );
}
