// ────────────────────────────────────────────────────────────────
// WebGL post-processing layer ("HD graphics").
//
// The game keeps drawing with Canvas 2D. In HD mode the world is drawn
// into an offscreen 2D canvas and the HUD into a second one; this module
// uploads both as textures every frame and composites them on a WebGL
// canvas that sits on top of the (event-receiving) 2D canvas:
//
//   world ──► bright-pass ─► blur H ─► blur V ─► (×2) ─► bloom
//     │                                                  │
//     └──► lighting (ambient + point + cone lights) ─────┴─► grade ─► + HUD
//
// Lighting is a classic 2D light-map: the scene colour is multiplied by
// ambient + Σ lights, bright pixels count as emissive (windows, flames,
// tracers stay lit in the dark) and every light adds a little in-air
// scatter so muzzle flashes and floodlights read as volumetric. The HUD
// is composited last so it is never darkened or graded.
//
// WebGL 1 only, no extensions, so it runs everywhere Canvas does. If
// context creation or shader compilation fails, `createPostFX` returns
// null and the game silently keeps the classic renderer.
// ────────────────────────────────────────────────────────────────

export const MAX_LIGHTS = 48;
export const MAX_CONES = 6;

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Bright pass: keeps only what is above the threshold, soft knee.
const FS_BRIGHT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
void main() {
  vec4 t = texture2D(uTex, vUv);
  vec3 c = t.rgb * t.a;           // composite over black (cleared areas)
  float l = max(max(c.r, c.g), c.b);
  float k = smoothstep(uThreshold, uThreshold + 0.25, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

// 9-tap separable gaussian using linear filtering (5 fetches).
const FS_BLUR = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270270;
  c += texture2D(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const FS_FINAL = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uHud;
uniform vec2 uRes;             // logical canvas size (CSS px)
uniform float uAmbient;
uniform vec3 uTint;            // ambient colour
uniform vec4 uL[${MAX_LIGHTS}];   // x, y, radius, intensity
uniform vec3 uLC[${MAX_LIGHTS}];  // colour
uniform int uNL;
uniform vec4 uC[${MAX_CONES}];    // x, y, direction (rad), half-angle (rad)
uniform vec3 uCC[${MAX_CONES}];   // colour
uniform vec2 uCP[${MAX_CONES}];   // radius, intensity
uniform int uNC;
uniform float uBloomStr;
uniform float uScatter;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uSat;
uniform float uFlash;          // full-screen flash (explosions)

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec2 p = vec2(uv.x, 1.0 - uv.y) * uRes;      // pixel position, y down
  vec2 d = uv - 0.5;
  // Very light chromatic aberration towards the corners (lens feel).
  float ca = dot(d, d) * 0.006;
  vec3 sc;
  sc.r = texture2D(uScene, uv + d * ca).r;
  sc.g = texture2D(uScene, uv).g;
  sc.b = texture2D(uScene, uv - d * ca).b;
  // Areas the 2D renderer cleared but never painted are transparent;
  // treat them as black instead of their un-premultiplied colour.
  sc *= texture2D(uScene, uv).a;

  vec3 light = uTint * uAmbient;
  vec3 scatter = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uNL) break;
    vec4 L = uL[i];
    float dist = length(p - L.xy);
    float a = clamp(1.0 - dist / L.z, 0.0, 1.0);
    a = a * a;
    light += uLC[i] * a * L.w;
    scatter += uLC[i] * a * a * L.w;
  }
  for (int i = 0; i < ${MAX_CONES}; i++) {
    if (i >= uNC) break;
    vec4 K = uC[i];
    vec2 v = p - K.xy;
    float dist = length(v);
    float ang = abs(atan(v.y, v.x) - K.z);
    ang = min(ang, 6.2831853 - ang);
    float edge = 1.0 - smoothstep(K.w * 0.55, K.w, ang);
    float fall = clamp(1.0 - dist / uCP[i].x, 0.0, 1.0);
    float a = edge * fall * fall * uCP[i].y;
    light += uCC[i] * a;
    scatter += uCC[i] * a * 0.55;
  }

  // Bright, saturated pixels are emissive (flames, lit windows, tracers,
  // damage numbers): they keep their own brightness in the dark.
  float mx = max(max(sc.r, sc.g), sc.b);
  float emis = smoothstep(0.55, 0.92, mx);
  light = mix(light, max(light, vec3(1.0)), emis);

  vec3 col = sc * light + scatter * uScatter;
  col += texture2D(uBloom, uv).rgb * uBloomStr;
  col += vec3(1.0, 0.85, 0.6) * uFlash;

  // Grade: gentle filmic shoulder, cool shadows / warm highlights,
  // saturation control.
  col = col / (1.0 + col * 0.18) * 1.12;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, uSat);
  col += vec3(-0.012, 0.004, 0.022) * (1.0 - smoothstep(0.0, 0.35, luma));
  col += vec3(0.020, 0.008, -0.016) * smoothstep(0.45, 1.0, luma);

  // Vignette + film grain.
  float vig = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.85)));
  col *= mix(1.0 - uVignette, 1.0, vig);
  col += (hash(p + fract(uTime) * 91.7) - 0.5) * uGrain;

  // HUD on top, untouched by lighting / grading.
  vec4 h = texture2D(uHud, uv);
  col = mix(col, h.rgb, h.a);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log || 'shader compile failed');
  }
  return s;
}

function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function mkTex(gl, w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return t;
}

function mkTarget(gl, w, h) {
  const tex = mkTex(gl, w, h);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}

// Default look per scene. `lights` and `cones` are filled per frame by
// render/lighting.js; cinematics use the defaults (no darkening, bloom +
// grade only) because they are already art-directed.
export const DEFAULT_SCENE = {
  ambient: 1, tint: [1, 1, 1], lights: [], cones: [],
  bloom: 0.55, threshold: 0.62, scatter: 0.22, vignette: 0.32, grain: 0.035, sat: 1.0, flash: 0,
};

export function createPostFX(glCanvas, cssW, cssH) {
  let gl;
  try {
    gl = glCanvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false })
      || glCanvas.getContext('experimental-webgl');
  } catch (_e) { gl = null; }
  if (!gl) return null;

  let progs;
  try {
    progs = { bright: program(gl, FS_BRIGHT), blur: program(gl, FS_BLUR), final: program(gl, FS_FINAL) };
  } catch (e) {
    console.warn('PostFX disabled:', e.message);
    return null;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const sceneTex = mkTex(gl);
  const hudTex = mkTex(gl);
  let W = 0, H = 0, bloomA = null, bloomB = null;

  const resize = (w, h) => {
    if (w === W && h === H) return;
    W = w; H = h;
    glCanvas.width = w; glCanvas.height = h;
    const bw = Math.max(1, Math.round(w / 4)), bh = Math.max(1, Math.round(h / 4));
    bloomA = mkTarget(gl, bw, bh);
    bloomB = mkTarget(gl, bw, bh);
  };

  const upload = (tex, src) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  };

  const draw = (prog, target) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : W, target ? target.h : H);
    gl.useProgram(prog.p);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const lArr = new Float32Array(MAX_LIGHTS * 4), lcArr = new Float32Array(MAX_LIGHTS * 3);
  const cArr = new Float32Array(MAX_CONES * 4), ccArr = new Float32Array(MAX_CONES * 3), cpArr = new Float32Array(MAX_CONES * 2);

  return {
    lost: () => gl.isContextLost(),
    render(worldCanvas, hudCanvas, scene, time) {
      const S = { ...DEFAULT_SCENE, ...(scene || {}) };
      resize(worldCanvas.width, worldCanvas.height);
      gl.activeTexture(gl.TEXTURE0); upload(sceneTex, worldCanvas);
      gl.activeTexture(gl.TEXTURE2); upload(hudTex, hudCanvas);

      // Bloom: bright pass to quarter res, then two blur iterations.
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.useProgram(progs.bright.p);
      gl.uniform1i(progs.bright.u.uTex, 0);
      gl.uniform1f(progs.bright.u.uThreshold, S.threshold);
      draw(progs.bright, bloomA);
      gl.useProgram(progs.blur.p);
      gl.uniform1i(progs.blur.u.uTex, 0);
      for (let i = 0; i < 2; i++) {
        const s = i + 1;
        gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
        gl.uniform2f(progs.blur.u.uDir, s / bloomA.w, 0);
        draw(progs.blur, bloomB);
        gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
        gl.uniform2f(progs.blur.u.uDir, 0, s / bloomA.h);
        draw(progs.blur, bloomA);
      }

      // Final composite.
      const F = progs.final;
      gl.useProgram(F.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, hudTex);
      gl.uniform1i(F.u.uScene, 0); gl.uniform1i(F.u.uBloom, 1); gl.uniform1i(F.u.uHud, 2);
      gl.uniform2f(F.u.uRes, cssW, cssH);
      gl.uniform1f(F.u.uAmbient, S.ambient);
      gl.uniform3f(F.u.uTint, S.tint[0], S.tint[1], S.tint[2]);
      const nl = Math.min(MAX_LIGHTS, S.lights.length);
      for (let i = 0; i < nl; i++) {
        const l = S.lights[i];
        lArr[i * 4] = l.x; lArr[i * 4 + 1] = l.y; lArr[i * 4 + 2] = l.r; lArr[i * 4 + 3] = l.i;
        lcArr[i * 3] = l.c[0]; lcArr[i * 3 + 1] = l.c[1]; lcArr[i * 3 + 2] = l.c[2];
      }
      gl.uniform4fv(F.u.uL, lArr); gl.uniform3fv(F.u.uLC, lcArr); gl.uniform1i(F.u.uNL, nl);
      const nc = Math.min(MAX_CONES, S.cones.length);
      for (let i = 0; i < nc; i++) {
        const k = S.cones[i];
        cArr[i * 4] = k.x; cArr[i * 4 + 1] = k.y; cArr[i * 4 + 2] = k.dir; cArr[i * 4 + 3] = k.half;
        ccArr[i * 3] = k.c[0]; ccArr[i * 3 + 1] = k.c[1]; ccArr[i * 3 + 2] = k.c[2];
        cpArr[i * 2] = k.r; cpArr[i * 2 + 1] = k.i;
      }
      gl.uniform4fv(F.u.uC, cArr); gl.uniform3fv(F.u.uCC, ccArr); gl.uniform2fv(F.u.uCP, cpArr); gl.uniform1i(F.u.uNC, nc);
      gl.uniform1f(F.u.uBloomStr, S.bloom);
      gl.uniform1f(F.u.uScatter, S.scatter);
      gl.uniform1f(F.u.uVignette, S.vignette);
      gl.uniform1f(F.u.uGrain, S.grain);
      gl.uniform1f(F.u.uSat, S.sat);
      gl.uniform1f(F.u.uFlash, S.flash || 0);
      gl.uniform1f(F.u.uTime, (time || 0) / 1000);
      draw(F, null);
    },
  };
}
