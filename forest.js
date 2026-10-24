import { createForestTuning, bendDirection } from "./forest-tuning.js";
// WebGL2 feedback layers. Search supplies structure; only stroke shape is varied here.
export class Forest {
  constructor(board, ground) {
    this.ground = ground;
    this.id = 0;
    this.queue = [];
    this.fen = "";
    this.selected = null;
    this.tuning = createForestTuning();
    this.options = this.tuning.read();
    this.settings = {
      forest: { strokeOpacity: 0.28, fade: 1, tint: null },
      selected: { strokeOpacity: 0.4, canvasOpacity: 1, fade: 1.4, tint: null },
    };
    this.stats = {
      batches: 0,
      paths: 0,
      selectedPaths: 0,
      queued: 0,
      visited: 0,
    };
    this.canvas = document.createElement("canvas");
    this.canvas.className = "forest-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    board.parentElement.append(this.canvas);
    this.status = document.querySelector("#forest-status");
    this.gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
    });
    if (!this.gl) {
      this.status.textContent =
        "Forest unavailable: WebGL2 is required. Chess still works.";
      return;
    }
    try {
      this.setup();
    } catch (e) {
      this.status.textContent = "Forest unavailable. Chess still works.";
      console.error(e);
      return;
    }
    this.worker = new Worker(new URL("./explorer-worker.js", import.meta.url));
    this.worker.onmessage = ({ data }) => {
      if (data.id !== this.id) return;
      if (data.error) {
        this.status.textContent = "Explorer paused: " + data.error;
        return;
      }
      this.stats.batches++;
      this.stats.visited += data.visited;
      for (const moves of data.paths)
        this.queue.push({ moves, seed: data.cycle });
      if (this.queue.length > 240)
        this.queue.splice(0, this.queue.length - 240);
      this.status.textContent =
        "Live search · select a piece to bring its tree forward";
    };
    this.worker.onerror = () => {
      this.status.textContent = "Explorer unavailable. Chess still works.";
    };
    this.resize = new ResizeObserver(() => this.size());
    this.resize.observe(board);
    this.size();
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      this.status.textContent =
        "Forest paused: graphics context lost. Reload to resume.";
      this.worker.terminate();
    });
    this.last = performance.now();
    const frame = (time) => {
      if (this.lost) return;
      this.paint(Math.min((time - this.last) / 1000, 0.1));
      this.last = time;
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
  program(v, f) {
    const g = this.gl,
      p = g.createProgram();
    for (const [type, src] of [
      [g.VERTEX_SHADER, v],
      [g.FRAGMENT_SHADER, f],
    ]) {
      const s = g.createShader(type);
      g.shaderSource(s, src);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS))
        throw Error(g.getShaderInfoLog(s));
      g.attachShader(p, s);
      g.deleteShader(s);
    }
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS))
      throw Error(g.getProgramInfoLog(p));
    return p;
  }
  setup() {
    const g = this.gl;
    const full = `#version 300 es
    out vec2 uv; void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0,1);}`;
    this.fade = this.program(
      full,
      `#version 300 es
    precision highp float; in vec2 uv; uniform sampler2D image; uniform float keep;uniform float frame;out vec4 outColor;
    void main(){vec4 c=texture(image,uv)*keep;
    // Unbiased quantization lets faint RGBA8 trails fade even at high refresh rates.
    float noise=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+frame)*43758.5453)-.5;
    outColor=clamp(c+noise/255.,0.,1.);}`,
    );
    this.composite = this.program(
      full,
      `#version 300 es
    precision highp float;in vec2 uv;uniform sampler2D forest;uniform sampler2D selected;uniform float opacity;uniform float selectedOpacity;out vec4 outColor;
    void main(){vec4 a=texture(forest,uv)*opacity;vec4 b=texture(selected,uv)*selectedOpacity;outColor=b+a*(1.-b.a);}`,
    );
    this.stroke = this.program(
      `#version 300 es
    layout(location=0) in vec2 position;layout(location=1) in vec4 color;out vec4 tint;
    void main(){gl_Position=vec4(position,0,1);tint=color;}`,
      `#version 300 es
    precision highp float;in vec4 tint;out vec4 outColor;void main(){outColor=vec4(tint.rgb*tint.a,tint.a);}`,
    );
    this.vao = g.createVertexArray();
    g.bindVertexArray(this.vao);
    this.buffer = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 24, 0);
    g.enableVertexAttribArray(1);
    g.vertexAttribPointer(1, 4, g.FLOAT, false, 24, 8);
    g.bindVertexArray(null);
    this.layers = [];
  }
  size() {
    const g = this.gl,
      r = this.canvas.getBoundingClientRect(),
      d = Math.min(devicePixelRatio || 1, 2);
    const n = Math.max(1, Math.round(r.width * d));
    if (this.canvas.width === n && this.layers.length) return;
    this.canvas.width = this.canvas.height = n;
    for (const l of this.layers)
      for (const t of l) {
        g.deleteTexture(t.texture);
        g.deleteFramebuffer(t.fb);
      }
    this.layers = Array.from({ length: 2 }, () =>
      Array.from({ length: 2 }, () => {
        const texture = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, texture);
        g.texImage2D(
          g.TEXTURE_2D,
          0,
          g.RGBA8,
          n,
          n,
          0,
          g.RGBA,
          g.UNSIGNED_BYTE,
          null,
        );
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        const fb = g.createFramebuffer();
        g.bindFramebuffer(g.FRAMEBUFFER, fb);
        g.framebufferTexture2D(
          g.FRAMEBUFFER,
          g.COLOR_ATTACHMENT0,
          g.TEXTURE_2D,
          texture,
          0,
        );
        if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE)
          throw Error("Incomplete forest framebuffer");
        return { texture, fb };
      }),
    );
    this.clear();
  }
  clear() {
    const g = this.gl;
    for (const l of this.layers)
      for (const t of l) {
        g.bindFramebuffer(g.FRAMEBUFFER, t.fb);
        g.clearColor(0, 0, 0, 0);
        g.clear(g.COLOR_BUFFER_BIT);
      }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  }
  setPosition(fen) {
    if (!this.worker || fen === this.fen) return;
    clearTimeout(this.searchTimer);
    this.fen = fen;
    this.id++;
    this.queue = [];
    this.stats.visited = 0;
    this.clear();
    this.worker.postMessage({ id: this.id, fen, ...this.searchOptions() });
  }
  searchOptions() {
    const { searchDepth, burstMs, intervalMs } = this.options;
    return { searchDepth, burstMs, intervalMs };
  }
  point(square) {
    let x = (square.charCodeAt(0) - 97 + 0.5) / 8,
      y = (Number(square[1]) - 0.5) / 8;
    if (this.ground.state.orientation === "black") {
      x = 1 - x;
      y = 1 - y;
    }
    return [x * 2 - 1, y * 2 - 1];
  }
  vertices(path, selected) {
    // Piece IDs are their squares in the root position, retained throughout the variation.
    const ids = new Map(),
      journeys = new Map();
    const rows = this.fen.split(" ")[0].split("/");
    rows.forEach((row, r) => {
      let f = 0;
      for (const c of row) {
        if (/[1-8]/.test(c)) f += Number(c);
        else {
          const sq = String.fromCharCode(97 + f++) + (8 - r);
          ids.set(sq, sq);
        }
      }
    });
    for (const m of path.moves) {
      const id = ids.get(m.from);
      if (!id) continue;
      const occupied = ids.has(m.to);
      ids.delete(m.from);
      ids.set(m.to, id);
      if (m.piece === "p" && m.capture && !occupied && m.from[0] !== m.to[0])
        ids.delete(m.to[0] + m.from[1]);
      if (m.castle) {
        const from = (m.to[0] === "g" ? "h" : "a") + m.from[1],
          to = (m.to[0] === "g" ? "f" : "d") + m.from[1];
        const rook = ids.get(from);
        ids.delete(from);
        if (rook) {
          ids.set(to, rook);
          let r = journeys.get(rook);
          if (!r) {
            r = { color: m.color, points: [from], checks: [] };
            journeys.set(rook, r);
          }
          r.points.push(to);
          r.checks.push(m.check);
        }
      }
      let j = journeys.get(id);
      if (!j) {
        j = { color: m.color, points: [m.from], checks: [] };
        journeys.set(id, j);
      }
      j.points.push(m.to);
      j.checks.push(m.check);
    }
    const out = [];
    for (const [id, j] of journeys) {
      if ((id === this.selected) !== selected) continue;
      const pts = j.points.map((s) => this.point(s));
      let start = pts[0];
      const options = this.options;
      for (let k = 1; k < pts.length; k++) {
        const target = pts[k],
          dx = target[0] - start[0],
          dy = target[1] - start[1],
          len = Math.hypot(dx, dy) || 1;
        const source = j.points[k - 1],
          destination = j.points[k];
        const direction = bendDirection(source);
        // A stable move hash varies magnitude; the search cycle cannot flip bends.
        const hash =
          [...(source + destination + id + k)].reduce(
            (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
            2166136261,
          ) >>> 0;
        const sign = direction * (hash / 4294967295);
        const jitter = Math.sin(hash + path.seed * 13.37);
        const scatter = (jitter * options.scatter) / Math.pow(k, options.taper);
        const bend =
          direction *
          (options.curvature + Math.abs(sign) * options.bendVariation);
        // Junction jitter is perpendicular, shared by adjacent segments.
        const end = [
          target[0] - (dy / len) * scatter,
          target[1] + (dx / len) * scatter,
        ];
        const control = [
          (start[0] + end[0]) / 2 - (dy / len) * bend,
          (start[1] + end[1]) / 2 + (dx / len) * bend,
        ];
        const settings = selected
          ? this.settings.selected
          : this.settings.forest;
        const prefix = selected
          ? "selected"
          : j.color === "w"
            ? "white"
            : "black";
        const rgb = (hex) =>
          [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
        const first = rgb(options[prefix + "Start"]),
          last = rgb(options[prefix + "End"]);
        const tint = rgb(
          options[selected ? "selectedTintColor" : "forestTintColor"],
        );
        const strength = options[selected ? "selectedTint" : "forestTint"];
        const color = (t) =>
          first.map(
            (v, i) =>
              (v + (last[i] - v) * t) * (1 - strength) + tint[i] * strength,
          );
        // Stroke width remains in CSS pixels on high-DPI displays.
        const width =
            options.width /
            this.canvas.getBoundingClientRect().width /
            Math.pow(k, options.taper),
          alpha = settings.strokeOpacity;
        const bez = (t) => {
          const a = 1 - t;
          return [
            a * a * start[0] + 2 * a * t * control[0] + t * t * end[0],
            a * a * start[1] + 2 * a * t * control[1] + t * t * end[1],
          ];
        };
        for (let step = 0; step < options.segments; step++) {
          const t = step / options.segments,
            u = (step + 1) / options.segments,
            a = bez(t),
            b = bez(u),
            vx = b[0] - a[0],
            vy = b[1] - a[1],
            vl = Math.hypot(vx, vy) || 1;
          const nx = (-vy / vl) * width,
            ny = (vx / vl) * width;
          const ca = color((sign + 1) / 4 + t / 2),
            cb = color((sign + 1) / 4 + u / 2);
          const v = (p, side, c) => [
            p[0] + nx * side,
            p[1] + ny * side,
            ...c,
            alpha,
          ];
          out.push(
            ...v(a, -1, ca),
            ...v(a, 1, ca),
            ...v(b, 1, cb),
            ...v(a, -1, ca),
            ...v(b, 1, cb),
            ...v(b, -1, cb),
          );
        }
        start = end;
      }
    }
    return out;
  }
  paint(dt) {
    const g = this.gl;
    if (!this.layers.length) return;
    const previousSearch = JSON.stringify(this.searchOptions());
    this.options = this.tuning.read();
    const options = this.options;
    this.settings.forest.strokeOpacity = options.forestStroke;
    this.settings.forest.fade = options.forestFade;
    this.settings.selected.strokeOpacity = options.selectedStroke;
    this.settings.selected.fade = options.selectedFade;
    this.settings.selected.canvasOpacity = options.selectedOpacity / 100;
    if (previousSearch !== JSON.stringify(this.searchOptions()) && this.fen) {
      this.id++;
      this.queue = [];
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(
        () =>
          this.worker.postMessage({
            id: this.id,
            fen: this.fen,
            ...this.searchOptions(),
          }),
        250,
      );
    }
    const orientation = this.ground.state.orientation;
    if (orientation !== this.orientation) {
      this.orientation = orientation;
      this.clear();
      this.queue = [];
    }
    this.selected = this.ground.state.selected || null;
    const enabled = document.querySelector("#forest-enabled").checked;
    this.canvas.style.visibility = enabled ? "visible" : "hidden";
    const rate = options.rate;
    this.credit = Math.min((this.credit || 0) + dt * rate, 4);
    const paths = enabled ? this.queue.splice(0, Math.floor(this.credit)) : [];
    this.credit -= paths.length;
    this.stats.queued = this.queue.length;
    g.viewport(0, 0, this.canvas.width, this.canvas.height);
    const fade = options.fade;
    for (let layer = 0; layer < 2; layer++) {
      const pair = this.layers[layer];
      g.disable(g.BLEND);
      g.bindVertexArray(null);
      g.bindFramebuffer(g.FRAMEBUFFER, pair[1].fb);
      g.useProgram(this.fade);
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, pair[0].texture);
      g.uniform1i(g.getUniformLocation(this.fade, "image"), 0);
      g.uniform1f(
        g.getUniformLocation(this.fade, "keep"),
        Math.exp(
          -dt *
            fade *
            (layer ? this.settings.selected.fade : this.settings.forest.fade),
        ),
      );
      g.uniform1f(
        g.getUniformLocation(this.fade, "frame"),
        performance.now() % 10000,
      );
      g.drawArrays(g.TRIANGLES, 0, 3);
      const vertices = paths.flatMap((p) => this.vertices(p, layer === 1));
      if (vertices.length) {
        g.enable(g.BLEND);
        g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
        g.useProgram(this.stroke);
        g.bindVertexArray(this.vao);
        g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
        g.bufferData(
          g.ARRAY_BUFFER,
          new Float32Array(vertices),
          g.DYNAMIC_DRAW,
        );
        g.drawArrays(g.TRIANGLES, 0, vertices.length / 6);
      }
      pair.reverse();
      if (layer === 1 && vertices.length)
        this.stats.selectedPaths += paths.length;
    }
    this.stats.paths += paths.length;
    g.bindVertexArray(null);
    g.disable(g.BLEND);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.useProgram(this.composite);
    for (let i = 0; i < 2; i++) {
      g.activeTexture(g.TEXTURE0 + i);
      g.bindTexture(g.TEXTURE_2D, this.layers[i][0].texture);
    }
    g.uniform1i(g.getUniformLocation(this.composite, "forest"), 0);
    g.uniform1i(g.getUniformLocation(this.composite, "selected"), 1);
    g.uniform1f(
      g.getUniformLocation(this.composite, "selectedOpacity"),
      this.settings.selected.canvasOpacity,
    );
    g.uniform1f(
      g.getUniformLocation(this.composite, "opacity"),
      options.forestOpacity / 100,
    );
    g.drawArrays(g.TRIANGLES, 0, 3);
  }
}
