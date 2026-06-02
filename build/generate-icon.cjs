const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'icon.svg');
const pngPath = path.join(__dirname, 'icon.png');

const svg = fs.readFileSync(svgPath);

// Generate 512x512 PNG (electron-builder will scale down as needed)
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 512 },
  background: 'transparent',
});
const pngData = resvg.render().asPng();
fs.writeFileSync(pngPath, pngData);
console.log(`Wrote ${pngPath} (${pngData.length} bytes)`);
