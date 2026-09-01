import * as THREE from "three";
import vertexShader from "../shaders/transition.vert.glsl";
import fragmentShader from "../shaders/transition.frag.glsl";

const DURATION_MS = 550;

export class SectionTransition {
  constructor(canvas) {
    this.canvas = canvas;
    this.supported = false;

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setClearColor(0x000000, 0);
      this.supported = true;
    } catch {
      return;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.uniforms = {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2() },
    };

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.scene.add(new THREE.Mesh(geometry, material));

    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _resize() {
    if (!this.supported) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    this.renderer.setSize(width, height, false);
    this.uniforms.uResolution.value.set(width, height);
  }

  play(onMidpoint) {
    if (!this.supported) {
      onMidpoint();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const start = performance.now();
      let swapped = false;

      const tick = (now) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / DURATION_MS, 1);
        this.uniforms.uProgress.value = t;
        this.uniforms.uTime.value = elapsed / 1000;
        this.renderer.render(this.scene, this.camera);

        if (!swapped && t >= 0.5) {
          swapped = true;
          onMidpoint();
        }

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          this.renderer.clear();
          resolve();
        }
      };

      requestAnimationFrame(tick);
    });
  }
}
