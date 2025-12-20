// Slidtrix rules overview:
// - Movement is tick-based and deterministic
// - player slide until blocked by a wall, sticky tile, or boundary
// - Input only sets direction; it does not move immediately
// - Conveyors only activate when the player is stopped
// - Sticky tiles allow changing direction mid-slide
// - Lava kills immediately on entry
// - Trap kills only after movement has fully stopped

// Do not reintroduce multiple players without redesigning:
// - collision rules
// - input ownership
// - win/death priority

// NOTE: Order matters — tiles are cycled in this exact sequence in the editor
const TILE_TYPES = ['wall', 'empty', 'start', 'end', 'sticky', 'conveyor-up', 'conveyor-down', 'conveyor-left', 'conveyor-right', 'trap', 'lava', 'portal',];

// Symbols for display
const TILE_SYMBOLS = {
  wall: '#',
  empty: '.',
  start: '*',
  end: '~',
  sticky: '&',
  player: '@',
  'conveyor-up': '↑',
  'conveyor-down': '↓',
  'conveyor-left': '←',
  'conveyor-right': '→',
  trap: 'X',
  lava: '▒',
  portal: '☉',
};

const gridSize = 10;
const grid = [];     
let player = null;              
let gameStarted = false;
let tickInterval = null;

const statusEl = document.getElementById('status');
const gridEl = document.getElementById('grid');

function setStatus(msg) {
  statusEl.textContent = msg;
}

function createGrid() {
  gridEl.style.gridTemplateColumns = `repeat(${gridSize}, 40px)`;
  gridEl.style.gridTemplateRows = `repeat(${gridSize}, 40px)`;
  for (let y = 0; y < gridSize; y++) {
    grid[y] = [];
    for (let x = 0; x < gridSize; x++) {
      const cell = { x, y, type: 'wall' };
      grid[y][x] = cell;

      const div = document.createElement('div');
      div.className = 'tile';
      div.dataset.x = x;
      div.dataset.y = y;
      div.innerText = TILE_SYMBOLS[cell.type];

      div.addEventListener('click', () => {
        if (gameStarted) return;
        cycleTile(cell, div, false); // normal forward cycle
      });
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (gameStarted) return;
        cycleTile(cell, div, true); // backwards cycle
      });

      cell.el = div;
      gridEl.appendChild(div);
    }
  }
}

// Editor-only tile cycling; disabled once the game starts
// Left click = forward, right click = backward
function cycleTile(cell, el, backwards = false) {
  const currentIndex = TILE_TYPES.indexOf(cell.type);
  let nextIndex;
  if (backwards) {
    nextIndex = (currentIndex - 1 + TILE_TYPES.length) % TILE_TYPES.length;
  } else {
    nextIndex = (currentIndex + 1) % TILE_TYPES.length;
  }
  cell.type = TILE_TYPES[nextIndex];
  el.innerText = TILE_SYMBOLS[cell.type];
}

// Rendering is purely visual; game state is updated only in the tick loop
function renderGrid() {
  for (let row of grid) {
    for (let cell of row) {
      cell.el.innerText = TILE_SYMBOLS[cell.type];
    }
  }

  // ONLY draw player if one exists
  if (player && getCell(player.x, player.y)) {
    grid[player.y][player.x].el.innerText = TILE_SYMBOLS.player;
  }
}

function findAllStarts() {
  const starts = [];
  for (let row of grid) {
    for (let cell of row) {
      if (cell.type === 'start') starts.push({ x: cell.x, y: cell.y });
    }
  }
  return starts;
}

function getCell(x, y) {
  if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) return null;
  return grid[y][x];
}

// Main simulation loop:
// - Runs at a fixed tick rate (not frame-based)
// - All movement, death, and win logic happens here
// - Rendering happens after simulation
function startTickLoop() {
  // Simulation assumes a single active player.
  // Logic here is not designed to support multiple entities.
  const tickDuration = 100; // 10 ticks/sec

  if (tickInterval) clearInterval(tickInterval);

  tickInterval = setInterval(() => {
    if (!gameStarted) return;

      // Sliding movement:
      // - Player continues moving in the current direction each tick
      // - Movement stops before entering walls or leaving the grid
      // - Entering lava kills immediately
      // - Entering sticky stops movement and allows turning
      if (player.moveDirection) {
        const nextX = player.x + player.moveDirection.dx;
        const nextY = player.y + player.moveDirection.dy;
        const nextCell = getCell(nextX, nextY);

        // stop before moving if next is wall or off-grid
        if (!nextCell || nextCell.type === 'wall') {
          player.moveDirection = null;
        } else {
          // move into next tile
          player.x = nextX;
          player.y = nextY;

        if (nextCell.type === 'portal') {
          // find the other portal
          for (let row of grid) {
            for (let cell of row) {
              if (cell.type === 'portal' && (cell.x !== nextX || cell.y !== nextY)) {
                player.x = cell.x;
                player.y = cell.y;
                break;
              }
            }
          }
          // momentum continues; don't reset moveDirection
        }
          if (nextCell.type === 'lava') {
            setStatus('You Died');
            resetGame();
            return;
          }

          // stop immediately if sticky and allow turning
          if (nextCell.type === 'sticky') {
            player.moveDirection = null;
            player.onSticky = true;
          }
        }
      }

      // Win condition:
      // - Player must be fully stopped on an end tile
      // - Sliding over the end tile does NOT count
      if (!player.moveDirection) {
        const currentCell = getCell(player.x, player.y);

        if (currentCell && currentCell.type === 'end') {
          clearInterval(tickInterval);
          tickInterval = null;
          gameStarted = false;
          renderGrid();
          setStatus('You Won');
          return;
        }

        // Trap rule:
        // - Trap only kills after the player has stopped moving
        // - This is intentional and different from lava
        if (currentCell && currentCell.type === 'trap') {
          setStatus('You Died');
          resetGame();
          return;
        }

        // Conveyor rule:
        // - Conveyors activate only when the player is stopped
        // - They move the player exactly one tile per tick
        // - Conveyors never push into walls
        // - Conveyors can push into lava (which kills immediately)

        if (currentCell && currentCell.type.startsWith('conveyor')) {
          let dx = 0, dy = 0;
          const dir = currentCell.type.split('-')[1];
          switch (dir) {
            case 'up': dy = -1; break;
            case 'down': dy = 1; break;
            case 'left': dx = -1; break;
            case 'right': dx = 1; break;
          }
          const nextCell = getCell(player.x + dx, player.y + dy);
          if (nextCell && nextCell.type !== 'wall') {
            player.x += dx;
            player.y += dy;

            // lava kills if conveyor pushes you onto it
            if (nextCell.type === 'lava') {
              setStatus('You Died');
              resetGame();
              return;
            }
          }
        }
      }

    renderGrid();
  }, tickDuration);
}

// Direction input:
// - Direction can only be changed when stopped
// - OR when standing on a sticky tile
// - Input affects the single player only.
// - There is no concept of per-player input or turns.
function setMoveDirection(dx, dy) {
  if (!gameStarted) return;

    if (!player.moveDirection || player.onSticky) {
      player.moveDirection = { dx, dy };
      player.onSticky = false; // reset sticky flag after turning
    }
}

// Resets runtime state only; the level layout is preserved
function resetGame() {
  setStatus('');
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
  gameStarted = false;
  player = null;
  renderGrid();
}

function validatePortals() {
  let portalCount = 0;
  for (let row of grid) {
    for (let cell of row) {
      if (cell.type === 'portal') portalCount++;
    }
  }
  if (portalCount !== 2 && portalCount !== 0) {
    alert('Level must have exactly 2 portals!');
    return false;
  }
  return true;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const starts = findAllStarts();
    if (starts.length === 0) {
      alert('Set a start tile first!');
      return;
    }
    // Exactly one player is spawned from the single start tile
    // Multiple start tiles are treated as a level design error
    if (starts.length > 1) {
      alert('Multiple start tiles detected. Please ensure exactly one start before starting.');
      return;
    }

    if (!validatePortals()) return; // <- check portals 

    player = { x: starts[0].x, y: starts[0].y, moveDirection: null, onSticky: false };
    gameStarted = true;
    renderGrid();
    startTickLoop();
    return;
  }

  if (e.key === 'r' || e.key === 'R') {
    resetGame();
    return;
  }

  if (!gameStarted) return;

  switch (e.key) {
    case 'ArrowUp': setMoveDirection(0, -1); break;
    case 'ArrowDown': setMoveDirection(0, 1); break;
    case 'ArrowLeft': setMoveDirection(-1, 0); break;
    case 'ArrowRight': setMoveDirection(1, 0); break;
  }
});

createGrid();
renderGrid();

function encodeBase64Unicode(str) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
      (_, p1) => String.fromCharCode('0x' + p1)
    )
  );
}

function decodeBase64Unicode(str) {
  return decodeURIComponent(
    Array.from(atob(str), c =>
      '%' + c.charCodeAt(0).toString(16).padStart(2, '0')
    ).join('')
  );
}

// Save codes store LEVEL STATE ONLY (grid + player positions)
// Runtime state (movement, sticky flags, active game) is intentionally reset
let levelTitle = '';
let levelAuthor = '';

function exportLevel() {
  const title = prompt('Enter level title:', levelTitle);
  if (title === null) return;
  levelTitle = title;

  const author = prompt('Enter author name:', levelAuthor);
  if (author === null) return;
  levelAuthor = author;

  const data = {
    title: levelTitle,
    author: levelAuthor,
    grid: grid.map(row => row.map(cell => cell.type))
  };

  const code = encodeBase64Unicode(JSON.stringify(data));
  prompt('Copy this save code:', code);
}

function loadFromCode(code) {
  try {
    const data = JSON.parse(decodeBase64Unicode(code));
    levelTitle = data.title || 'Untitled Level';
    levelAuthor = data.author || 'Unknown';

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        grid[y][x].type = data.grid[y][x];
      }
    }

    player = null; // reset runtime
    gameStarted = false;
    renderGrid();
    updateLevelMeta();
    alert(`Level loaded!\n${levelTitle} By: ${levelAuthor}`);
  } catch {
    alert('Invalid save code!');
  }
}

function updateLevelMeta() {
  const metaEl = document.getElementById('level-meta');
  if (metaEl) metaEl.textContent = `${levelTitle} By: ${levelAuthor}`;
}

// Attach hotkeys **after** functions exist
document.addEventListener('keydown', (e) => {
  if (e.key === 'o' || e.key === 'O') {
    exportLevel();
  } else if (e.key === 'p' || e.key === 'P') {
    const code = prompt('Paste your save code:');
    if (code) loadFromCode(code);
  }
});
