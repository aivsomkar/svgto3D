# svg ⟶ 3d

Minimal brutalist web tool that turns any SVG into an extruded 3D model and exports a looping filmstrip sprite.

## Features

- **Subjects** — built-in shapes (star, bolt, heart, arrow, ring, asterisk, hex, smile, drop), or upload / drag-drop any SVG
- **Materials** — chrome, gunmetal, porcelain, copper, lens, lens dark, brand (physically based, studio environment reflections), plus a **custom** material with color, metalness, roughness, glass (transmission), and clearcoat controls
- **Depth & bevel** — sliders rebuild the extrusion live
- **Motion** — spin (turntable), object (settle, sway, pendulum, float, push in, nod, drop in), light (light pan, glint, flicker); all loop seamlessly over 4 s
- **Film** — choose frame count and frame size; the strip re-renders on every change
- **Export** — transparent PNG sprite sheet, transparent looping GIF (gifenc), or H.264 MP4 with 3 baked loops (WebCodecs + mp4-muxer; needs a browser with WebCodecs)

## Run

```sh
npm install
npm run dev
```

Built with Vite + Three.js. No backend — everything renders client-side with transparent backgrounds.
