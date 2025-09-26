const TILE_TYPES = ['wall', 'empty', 'start', 'end', 'sticky', 'conveyor-up', 'conveyor-down', 'conveyor-left', 'conveyor-right', 'trap', 'lava',];

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
  lava: '',
};

const gridSize = 10;
const grid = [];     
let players = [];              
let gameStarted = false;
let tickInterval = null;

const gridEl = document.getElementById('grid');

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
        cycleTile(cell, div);
      });

      cell.el = div;
      gridEl.appendChild(div);
    }
  }
}

// Cycle tile on click (click goes to next type)
function cycleTile(cell, el) {
  const currentIndex = TILE_TYPES.indexOf(cell.type);
  const nextIndex = (currentIndex + 1) % TILE_TYPES.length;
  cell.type = TILE_TYPES[nextIndex];
  el.innerText = TILE_SYMBOLS[cell.type];
}

function renderGrid() {
  for (let row of grid) {
    for (let cell of row) {
      cell.el.innerText = TILE_SYMBOLS[cell.type];
    }
  }
  for (let p of players) {
    if (getCell(p.x, p.y)) {
      grid[p.y][p.x].el.innerText = TILE_SYMBOLS.player;
    }
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

function startTickLoop() {
  const tickDuration = 100; // 10 ticks/sec

  if (tickInterval) clearInterval(tickInterval);

  tickInterval = setInterval(() => {
    if (!gameStarted) return;

    for (let player of players) {

      // --- sliding movement ---
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

          if (nextCell.type === 'lava') {
            alert('☠️ You fell into lava!');
            resetGame();
            return;
          }

          // stop immediately if sticky and allow turning
          if (nextCell.type === 'setTimeout(function() {}, 10);icky') {
            player.moveDirection = null;
            player.onSticky = true;
          }
        }
      }

      // --- check win if stopped on end ---
      if (!player.moveDirection) {
        const currentCell = getCell(player.x, player.y);

        if (currentCell && currentCell.type === 'end') {
          clearInterval(tickInterval);
          tickInterval = null;
          gameStarted = false;
          renderGrid();
            setTimeout(() => alert('🎉 You reached the end!'), 100);
          return;
        }

        // check death if landed on trap
        if (currentCell && currentCell.type === 'trap') {
          alert('💀 You stepped on a trap!');
          resetGame();
          return;
        }

        // --- conveyor tiles: move 1 tile if stopped ---
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
          if (nextCell && nextCell.type !== 'wall' && nextCell.type !== 'sticky') {
            player.x += dx;
            player.y += dy;

            // lava kills if conveyor pushes you onto it
            if (nextCell.type === 'lava') {
              alert('☠️ Conveyor threw you into lava!');
              resetGame();
              return;
            }
          }
        }
      }
    }

    renderGrid();
  }, tickDuration);
}

// Set movement direction — allows turning on sticky
function setMoveDirection(dx, dy) {
  if (!gameStarted) return;

  for (let p of players) {
    if (!p.moveDirection || p.onSticky) {
      p.moveDirection = { dx, dy };
      p.onSticky = false; // reset sticky flag after turning
    }
  }
}

function resetGame() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
  gameStarted = false;
  players = [];
  renderGrid();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const starts = findAllStarts();
    if (starts.length === 0) {
      alert('Set a start tile first!');
      return;
    }
    if (starts.length > 1) {
      alert('Multiple start tiles detected. Please ensure exactly one start before starting.');
      return;
    }
    players = [{ x: starts[0].x, y: starts[0].y, moveDirection: null }];
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

// Save code
function generateSaveCode() {
  const data = {
    grid: grid.map(row => row.map(cell => cell.type)),
    players: players.map(p => ({ x: p.x, y: p.y }))
  };
  const json = JSON.stringify(data);
  return btoa(json); // encode as base64 string
}

// Load code
function loadFromCode(code) {
  try {
    const json = atob(code); // decode base64
    const data = JSON.parse(json);

    // restore grid
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        grid[y][x].type = data.grid[y][x];
      }
    }

    // restore players
    players = data.players.map(p => ({
      x: p.x,
      y: p.y,
      moveDirection: null,
      onSticky: false
    }));

    gameStarted = false; // start fresh
    renderGrid();
    alert('Maze loaded from code!');
  } catch (e) {
    alert('Invalid save code!');
  }
}

function loadLevel(levelCode) {
  decodeAndLoadLevel(levelCode);
  gameStarted = true;
  renderGrid();
}

// Keybinds
document.addEventListener('keydown', (e) => {
  if (e.key === 'o' || e.key === 'O') {
    const code = generateSaveCode();
    prompt('Copy this save code:', code);
  } else if (e.key === 'p' || e.key === 'P') {
    const code = prompt('Paste your save code:');
    if (code) loadFromCode(code);
  }
});
