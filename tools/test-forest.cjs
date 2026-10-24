// Run against python3 -m http.server 8123 from the repository root.
const assert = require("node:assert/strict");
const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
    ],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:8123/", { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.game?.forest.stats.paths > 20, {
      timeout: 30000,
    });
    assert.equal(await page.evaluate(() => game.chess.history().length), 0);
    const pixels = await page.evaluate(() => {
      const f = game.forest,
        g = f.gl;
      g.bindFramebuffer(g.FRAMEBUFFER, f.layers[0][0].fb);
      const p = new Uint8Array(
        g.drawingBufferWidth * g.drawingBufferHeight * 4,
      );
      g.readPixels(
        0,
        0,
        g.drawingBufferWidth,
        g.drawingBufferHeight,
        g.RGBA,
        g.UNSIGNED_BYTE,
        p,
      );
      g.bindFramebuffer(g.FRAMEBUFFER, null);
      const opacity =
        Number(document.querySelector("#forest-opacity").value) / 100;
      let visible = 0;
      for (let i = 0; i < p.length; i += 4) {
        // Contrast on either board-square colour, not merely nonzero alpha.
        const contrast = [
          [240, 217, 181],
          [181, 136, 99],
        ].map((bg) =>
          Math.max(
            ...bg.map((v, channel) =>
              Math.abs((p[i + channel] - (v * p[i + 3]) / 255) * opacity),
            ),
          ),
        );
        if (Math.min(...contrast) >= 20) visible++;
      }
      return {
        painted: p.filter((v, i) => i % 4 === 3 && v > 0).length,
        visible,
      };
    });
    assert(pixels.painted > 100, "Opening forest must actually paint pixels");
    assert(
      pixels.visible > 1500,
      "Default forest must visibly contrast with the board",
    );
    const audit = await page.evaluate(async () => {
      const fens = [
        game.chess.fen(),
        "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
        "4k3/P7/8/8/8/8/7p/4K3 w - - 0 1",
        "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1",
      ];
      const worker = new Worker("./explorer-worker.js");
      let checked = 0,
        black = 0;
      try {
        for (let id = 0; id < fens.length; id++) {
          const batch = await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(Error("Worker timeout")), 15000);
            worker.onmessage = ({ data }) => {
              if (data.id !== id) return;
              clearTimeout(t);
              data.error ? reject(Error(data.error)) : resolve(data);
            };
            worker.postMessage({ id, fen: fens[id] });
          });
          if (!batch.paths.length) throw Error("No actual search paths");
          for (const path of batch.paths) {
            const chess = new game.chess.constructor(fens[id]);
            for (const m of path) {
              const candidates = chess
                .moves({ verbose: true })
                .filter(
                  (v) =>
                    v.from === m.from &&
                    v.to === m.to &&
                    v.promotion === m.promotion,
                );
              if (!candidates.length || chess.turn() !== m.color)
                throw Error("Illegal search path " + JSON.stringify(m));
              const legal = candidates[0];
              chess.move({
                from: m.from,
                to: m.to,
                promotion: legal.promotion,
              });
              if (m.color === "b") black++;
              checked++;
            }
          }
        }
      } finally {
        worker.terminate();
      }
      return { checked, black };
    });
    assert(audit.checked > 100);
    assert(audit.black > 0);
    const r = await page.$eval("#board", (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.mouse.click(r.x + (r.w * 4.5) / 8, r.y + (r.h * 6.5) / 8);
    await page.waitForFunction(() => game.forest.stats.selectedPaths > 0, {
      timeout: 15000,
    });
    await page.screenshot({ path: "/tmp/lukechess-forest.png" });
    await page.mouse.click(r.x + (r.w * 4.5) / 8, r.y + (r.h * 4.5) / 8);
    await page.waitForFunction(() => game.chess.history().length === 2, {
      timeout: 30000,
    });
    await page.waitForFunction(
      () =>
        game.forest.fen === game.chess.fen() && game.forest.queue.length > 0,
    );
    const before = await page.evaluate(() => game.forest.id);
    await page.click("#undo");
    await page.waitForFunction(() => game.chess.history().length === 0);
    assert(await page.evaluate((n) => game.forest.id > n, before));
    // Desktop dragging remains usable through the overlay.
    await page.mouse.move(r.x + (r.w * 6.5) / 8, r.y + (r.h * 7.5) / 8);
    await page.mouse.down();
    await page.mouse.move(r.x + (r.w * 5.5) / 8, r.y + (r.h * 5.5) / 8, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForFunction(() => game.chess.history().length === 2, {
      timeout: 30000,
    });
    assert.equal(await page.evaluate(() => game.chess.history()[0]), "Nf3");
    await page.waitForFunction(
      () => game.forest.stats.visited > 0 && game.forest.queue.length > 0,
    );
    await page.evaluate(async () => {
      const until = performance.now() + 500;
      while (performance.now() < until)
        await new Promise(requestAnimationFrame);
    });
    // Freeze additions and measure real framebuffer decay, not just a running RAF.
    const decay = await page.evaluate(async () => {
      document.querySelector("#forest-enabled").checked = false;
      document.querySelector("#forest-fade").value = "1";
      const sum = () => {
        const f = game.forest,
          g = f.gl,
          p = new Uint8Array(f.canvas.width * f.canvas.height * 4);
        g.bindFramebuffer(g.FRAMEBUFFER, f.layers[0][0].fb);
        g.readPixels(
          0,
          0,
          f.canvas.width,
          f.canvas.height,
          g.RGBA,
          g.UNSIGNED_BYTE,
          p,
        );
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        let n = 0;
        for (let i = 3; i < p.length; i += 4) n += p[i];
        return n;
      };
      const before = sum();
      const until = performance.now() + 1200;
      while (performance.now() < until)
        await new Promise(requestAnimationFrame);
      return { before, after: sum() };
    });
    console.log("Feedback decay:", decay);
    assert(
      decay.before > 0 && decay.after < decay.before * 0.7,
      "Feedback must fade",
    );
    await page.click("#flip");
    await page.waitForFunction(() => game.forest.orientation === "black");
    await page.setViewport({ width: 390, height: 844 });
    await page.waitForFunction(() => game.forest.canvas.width < 1000);
    assert.equal(
      await page.$eval(
        ".forest-canvas",
        (e) => getComputedStyle(e).pointerEvents,
      ),
      "none",
    );
    const appearance = await page.evaluate(() => {
      const f = game.forest,
        fen = f.fen,
        options = f.options,
        selected = f.selected;
      f.fen = new game.chess.constructor().fen();
      f.selected = null;
      f.options = { ...options, scatter: 0, curvature: 0, bendVariation: 0 };
      const moves = [
        { from: "e2", to: "e4", piece: "p", color: "w", capture: false },
        { from: "d7", to: "d5", piece: "p", color: "b", capture: false },
        { from: "e4", to: "d5", piece: "p", color: "w", capture: true },
      ];
      const chunk = options.segments * 36;
      const ordinary = f.vertices(
        {
          seed: 0,
          moves: [
            moves[0],
            moves[1],
            { from: "g1", to: "f3", piece: "n", color: "w", capture: false },
          ],
        },
        false,
      );
      const alphas = [
        ordinary[5],
        ordinary[chunk + 5],
        ordinary[2 * chunk + 5],
      ];
      const last = chunk - 36;
      const startWidth = Math.hypot(
        ordinary[0] - ordinary[6],
        ordinary[1] - ordinary[7],
      );
      const endWidth = Math.hypot(
        ordinary[last + 12] - ordinary[last + 30],
        ordinary[last + 13] - ordinary[last + 31],
      );
      f.options.captureRadius = 0;
      const noRing = f.vertices({ seed: 0, moves }, false);
      // Both moves of the capturing pawn's entire journey must be red.
      let red = true;
      for (let i = 0; i < chunk * 2; i += 6)
        red &&=
          noRing[i + 2] > 0.8 && noRing[i + 3] < 0.05 && noRing[i + 4] < 0.05;
      f.options.captureRadius = 0.22;
      const ring = f.vertices({ seed: 0, moves }, false);
      const destination = f.point("d5");
      let sx = 0,
        sy = 0,
        count = 0;
      // Ring is appended after this pawn's two segments, before the black path.
      for (let i = chunk * 2; i < chunk * 2 + 48 * 36; i += 6) {
        sx += ring[i];
        sy += ring[i + 1];
        count++;
      }
      f.fen = fen;
      f.options = options;
      f.selected = selected;
      return {
        alphas,
        startWidth,
        endWidth,
        red,
        ringAdded: ring.length - noRing.length,
        centreError: Math.hypot(
          sx / count - destination[0],
          sy / count - destination[1],
        ),
      };
    });
    assert(
      appearance.startWidth > appearance.endWidth * 2,
      "Stroke must be widest at its source",
    );
    assert(
      appearance.alphas[0] > appearance.alphas[1] &&
        appearance.alphas[1] > appearance.alphas[2],
      "Actual search generations must fade progressively",
    );
    assert(appearance.red, "Entire capture-ending journey must be red");
    assert.equal(appearance.ringAdded, 48 * 36);
    assert(
      appearance.centreError < 1e-6,
      "Capture ring must centre on the real destination",
    );
    // Tuning must affect real geometry and persist through a reload.
    const tuning = await page.evaluate(async () => {
      const set = (key, value) => {
        const input = document.querySelector("#forest-" + key);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("scatter", 0);
      set("curvature", 0.08);
      set("bendVariation", 0.02);
      set("width", 2);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const f = game.forest;
      const path = {
        seed: 1,
        moves: [
          { from: "e2", to: "e4", piece: "p", color: "w", capture: false },
        ],
      };
      // Use the actual root board for this rendering-only geometry comparison.
      const fen = f.fen;
      f.fen = new game.chess.constructor().fen();
      f.selected = null;
      const a = f.vertices(path, false),
        b = f.vertices({ ...path, seed: 100 }, false);
      set("curvature", 0);
      set("bendVariation", 0);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const straight = f.vertices(path, false);
      f.fen = fen;
      const { bendDirection } = await import("./forest-tuning.js");
      return {
        same: JSON.stringify(a) === JSON.stringify(b),
        changed: JSON.stringify(a) !== JSON.stringify(straight),
        parity: bendDirection("e2") === -bendDirection("f2"),
        width: document.querySelector("#forest-width").value,
        output: document.querySelector('output[for="forest-width"]').value,
      };
    });
    assert(
      tuning.same,
      "Curvature must not vary with search cycle when scatter is zero",
    );
    assert(tuning.changed, "Curvature fader must change rendered geometry");
    assert(tuning.parity);
    assert.equal(tuning.output, "2");
    await page.reload();
    await page.waitForFunction(() => window.game);
    assert.equal(await page.$eval("#forest-width", (e) => e.value), "2");
    await page.click("#forest-tuning button");
    assert.equal(await page.$eval("#forest-width", (e) => e.value), "1.4");
    const fallback = await browser.newPage();
    await fallback.evaluateOnNewDocument(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === "webgl2" ? null : original.call(this, type, ...args);
      };
    });
    await fallback.goto("http://127.0.0.1:8123/");
    await fallback.waitForFunction(() => window.game);
    await fallback.evaluate(() => game.move("e2", "e4"));
    await fallback.waitForFunction(() => game.chess.history().length === 2);
    assert.match(
      await fallback.$eval("#forest-status", (e) => e.textContent),
      /WebGL2/,
    );
    await fallback.close();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        openingPaintedPixels: pixels,
        legalSearchSteps: audit.checked,
        blackSteps: audit.black,
        selection: true,
        tapAndStockfish: true,
        undo: true,
        flip: true,
        resize: true,
        drag: true,
        fade: true,
        browserErrors: errors,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
