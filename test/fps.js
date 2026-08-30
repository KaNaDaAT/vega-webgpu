let frameCount = 0;
let lastTime = performance.now();
let timeForUpdate = 0;
const fpsDisplay = document.getElementById('fpsDisplay');

let sum = 0;

function updateFPS() {
  const currentTime = performance.now();
  const deltaTime = currentTime - lastTime;
  timeForUpdate += deltaTime;
  sum += deltaTime;
  lastTime = currentTime;
  if (timeForUpdate >= 500) {
    const fps = 1000 / (sum / frameCount);
    frameCount = 0;
    timeForUpdate = 0;
    sum = 0;
    fpsDisplay.innerText = 'FPS: ' + Math.round(fps);
  }
}

// Update FPS every frame
function renderLoop() {
  updateFPS();
  frameCount++;
  requestAnimationFrame(renderLoop);
}

// Start rendering loop
renderLoop();
