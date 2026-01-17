const screenshot = require('screenshot-desktop');
const { Jimp } = require('jimp');

async function check() {
    const imgBuffer = await screenshot();
    const img = await Jimp.read(imgBuffer);
    console.log(`Screenshot size: ${img.width}x${img.height}`);
}
check();
