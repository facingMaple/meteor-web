import * as THREE from './vendor/three.module.js';
import { loadGmb } from './gmc-loader.js';

const root = new URL('./assets/weapon-skins/collection/', import.meta.url);
const framesPerSecond = 30;

// Copy just the current frame. The resulting regular texture retains the
// source's repeating UVs, including coordinates outside the 0-to-1 range.
async function atlasTexture(url, { width, height, columns, frames }) {
  const image = await new THREE.ImageLoader().loadAsync(url);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Animated weapon textures require a canvas');
  const texture = new THREE.CanvasTexture(canvas);
  let lastFrame = -1;
  const update = time => {
    const frame = frames[Math.floor(time * framesPerSecond) % frames.length];
    if (frame === lastFrame) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, frame % columns * width, Math.floor(frame / columns) * height,
      width, height, 0, 0, width, height);
    texture.needsUpdate = true;
    lastFrame = frame;
  };
  update(0);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return { texture, update };
}

export class WeaponCollectionAssets {
  constructor() {
    this.textures = new Map();
    this.loadedTextures = new Set();
    this.animations = new Set();
  }

  _manifest() {
    this.manifest ||= fetch(new URL('manifest.json', root)).then(response => {
      if (!response.ok) throw new Error('Weapon collection manifest unavailable');
      return response.json();
    }).catch(error => {
      this.manifest = null;
      throw error;
    });
    return this.manifest;
  }

  async _loadTexture(descriptor) {
    const url = new URL(descriptor.url, root).href;
    const { texture, update } = descriptor.atlas ? await atlasTexture(url, descriptor.atlas) : {
      texture: await new THREE.TextureLoader().loadAsync(url)
    };
    if (this.disposed) {
      texture.dispose();
      throw new Error('Weapon collection assets disposed');
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    this.loadedTextures.add(texture);
    if (update) this.animations.add(update);
    if (descriptor.scrollV) this.animations.add(time => { texture.offset.y = time * descriptor.scrollV % 1; });
    return texture;
  }

  _texture(id, descriptor) {
    if (!this.textures.has(id)) this.textures.set(id, this._loadTexture(descriptor).catch(error => {
      this.textures.delete(id);
      throw error;
    }));
    return this.textures.get(id);
  }

  async load(id) {
    const { models, textures } = await this._manifest();
    const entry = models[id];
    if (!entry) throw new Error(`Missing weapon collection model: ${id}`);
    const url = new URL(entry.url, root).href;
    const textureOverrides = Object.fromEntries(await Promise.all(entry.textures.map(async name =>
      [name, await this._texture(name, textures[name])]
    )));
    const model = await loadGmb(url, {
      name: id, source: entry.source, desUrl: url, scale: 1, groundZ: 0,
      unlit: true, skipEffects: false, vertexColors: false,
      textureOverrides, additiveTextures: entry.additive
    });
    if (entry.gripAttachments) model.userData.qiankunGripAttachments = entry.gripAttachments;
    return model;
  }

  update(time) {
    for (const update of this.animations) update(time);
  }

  dispose() {
    this.disposed = true;
    for (const texture of this.loadedTextures) texture.dispose();
    this.loadedTextures.clear();
    this.textures.clear();
    this.animations.clear();
  }
}
