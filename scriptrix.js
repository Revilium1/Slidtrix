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
const TILE_TYPES = [
  { type: 'wall', symbol: '#', color: '#555' },
  { type: 'floor', symbol: '.', color: '#fff' },
  { type: 'start', symbol: '*', color: '#0f0' },
  { type: 'end', symbol: '~', color: '#f00' },
  { type: 'sticky', symbol: '&', color: '#ff0' },
  { type: 'conveyor-up', symbol: '↑', color: '#0ff' },
  { type: 'conveyor-down', symbol: '↓', color: '#0ff' },
  { type: 'conveyor-left', symbol: '←', color: '#0ff' },
  { type: 'conveyor-right', symbol: '→', color: '#0ff' },
  { type: 'trap', symbol: 'X', color: '#f80' },
  { type: 'lava', symbol: '▒', color: '#f00' },
  { type: 'spikes', symbol: '^', color: '#f00' },
  { type: 'cracked-floor', symbol: '%', color: '#999' },
  { type: 'bumper', symbol: 'O', color: '#40f' },
  { type: 'rotate-left', symbol: '↺', color: '#071' },
  { type: 'rotate-right', symbol: '↻', color: '#071' },
  { type: 'portal', symbol: '☉', color: '#a0f' },
];

const PLAYER_SYMBOL = '@';
const PLAYER_COLOR = '#a0f';

function getTileDefinition(type) {
  return TILE_TYPES.find(tile => tile.type === type);
}

const gridSize = 10;
const grid = [];
const attemptSpikes = new Set();
const attemptCrackedFloors = new Set();
let player = null;              
let gameStarted = false;
let tickInterval = null;
const undoStack = [];
const redoStack = [];

const statusEl = document.getElementById('status');
const gridEl = document.getElementById('grid');
const gameStatsEl = document.getElementById('game-stats');
const movesEl = document.getElementById('moves-count');
const timerEl = document.getElementById('timer-count');
const ticksEl = document.getElementById('ticks-count');
let moveCount = 0;
let tickCount = 0;
let gameStartedAt = 0;
let gameEndedAt = null;
let gamePaused = false;
let pausedAt = null;
let totalPausedMs = 0;
const pauseButton = document.getElementById('pause-game');

function setStatus(msg) {
  statusEl.textContent = msg;
}

function startGameStats() {
  moveCount = 0;
  tickCount = 0;
  gameStartedAt = Date.now();
  gameEndedAt = null;
  gamePaused = false;
  pausedAt = null;
  totalPausedMs = 0;
  gameStatsEl.hidden = false;
  pauseButton.hidden = false;
  pauseButton.textContent = 'Pause';
  updateGameStats();
}

function updateGameStats() {
  const now = gameEndedAt ?? Date.now();
  const pausedMs = totalPausedMs + (gamePaused && pausedAt ? now - pausedAt : 0);
  const elapsedSeconds = gameStartedAt
    ? Math.floor((now - gameStartedAt - pausedMs) / 1000)
    : 0;
  const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
  const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
  movesEl.textContent = moveCount;
  timerEl.textContent = `${minutes}:${seconds}`;
  ticksEl.textContent = tickCount;
}

function finishGameStats() {
  gameEndedAt = Date.now();
  gamePaused = false;
  pausedAt = null;
  pauseButton.hidden = true;
  updateGameStats();
}

function toggleGamePause() {
  if (!gameStarted) return;

  gamePaused = !gamePaused;
  if (gamePaused) {
    pausedAt = Date.now();
    pauseButton.textContent = 'Resume';
  } else {
    totalPausedMs += Date.now() - pausedAt;
    pausedAt = null;
    pauseButton.textContent = 'Pause';
  }
  updateGameStats();
}

function clearGameStats() {
  gameStatsEl.hidden = true;
  pauseButton.hidden = true;
  gamePaused = false;
  pausedAt = null;
  totalPausedMs = 0;
  moveCount = 0;
  tickCount = 0;
  gameStartedAt = 0;
  gameEndedAt = null;
  updateGameStats();
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
      const tile = getTileDefinition(cell.type);
      div.innerText = tile.symbol;
      div.style.color = tile.color;

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
  exportPlaytestGrid = null;
  exportPlaytestPassed = false;
  const previousType = cell.type;
  const currentIndex = TILE_TYPES.findIndex(tile => tile.type === cell.type);
  let nextIndex;
  if (backwards) {
    nextIndex = (currentIndex - 1 + TILE_TYPES.length) % TILE_TYPES.length;
  } else {
    nextIndex = (currentIndex + 1) % TILE_TYPES.length;
  }
  const tile = TILE_TYPES[nextIndex];
  cell.type = tile.type;
  el.innerText = tile.symbol;
  el.style.color = tile.color;
  undoStack.push({ x: cell.x, y: cell.y, previousType, nextType: tile.type });
  redoStack.length = 0;
}

function undoTileEdit() {
  const edit = undoStack.pop();
  if (!edit) return;
  exportPlaytestGrid = null;
  exportPlaytestPassed = false;
  grid[edit.y][edit.x].type = edit.previousType;
  redoStack.push(edit);
  renderGrid();
}

function redoTileEdit() {
  const edit = redoStack.pop();
  if (!edit) return;
  exportPlaytestGrid = null;
  exportPlaytestPassed = false;
  grid[edit.y][edit.x].type = edit.nextType;
  undoStack.push(edit);
  renderGrid();
}

// Rendering is purely visual; game state is updated only in the tick loop
function renderGrid() {
  for (let row of grid) {
    for (let cell of row) {
      const tile = getTileDefinition(cell.type);
      cell.el.innerText = tile.symbol;
      cell.el.style.color = tile.color;
    }
  }

  // ONLY draw player if one exists
  if (player && getCell(player.x, player.y)) {
    grid[player.y][player.x].el.innerText = PLAYER_SYMBOL;
    grid[player.y][player.x].el.style.color = PLAYER_COLOR;
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

function turnSpikesToLava(cell) {
  if (cell.type !== 'spikes') return;
  attemptSpikes.add(cell);
  cell.type = 'lava';
}

function turnCrackedFloorToWall(cell) {
  if (cell.type !== 'cracked-floor') return;
  attemptCrackedFloors.add(cell);
  cell.type = 'wall';
}

function restoreAttemptSpikes() {
  for (const cell of attemptSpikes) cell.type = 'spikes';
  attemptSpikes.clear();
  for (const cell of attemptCrackedFloors) cell.type = 'cracked-floor';
  attemptCrackedFloors.clear();
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
    if (!gameStarted || gamePaused) return;
    tickCount++;
    updateGameStats();

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
          // Leaving spikes turns the tile into lava for this attempt.
          const previousCell = getCell(player.x, player.y);
          turnSpikesToLava(previousCell);
          turnCrackedFloorToWall(previousCell);

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

          // Bumpers reverse the player's momentum on entry.
          if (nextCell.type === 'bumper') {
            player.moveDirection = {
              dx: -player.moveDirection.dx,
              dy: -player.moveDirection.dy
            };
          } else if (nextCell.type === 'rotate-left') {
            player.moveDirection = {
              dx: player.moveDirection.dy,
              dy: -player.moveDirection.dx
            };
          } else if (nextCell.type === 'rotate-right') {
            player.moveDirection = {
              dx: -player.moveDirection.dy,
              dy: player.moveDirection.dx
            };
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
          finishGameStats();
          clearInterval(tickInterval);
          tickInterval = null;
          gameStarted = false;
          player = null;
          restoreAttemptSpikes();
          renderGrid();

          const clearedExportPlaytest = exportPlaytestGrid !== null &&
            exportPlaytestGrid === JSON.stringify(grid.map(row => row.map(cell => cell.type)));
          if (clearedExportPlaytest) {
            exportPlaytestGrid = null;
            exportPlaytestPassed = true;
            setStatus('You Won — clear check passed');
            exportLevel();
          } else {
            setStatus('You Won');
          }
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
            const previousCell = getCell(player.x, player.y);
            turnSpikesToLava(previousCell);
            turnCrackedFloorToWall(previousCell);
            player.x += dx;
            player.y += dy;

            // Special tiles can redirect the conveyor's push on entry.
            if (nextCell.type === 'bumper') {
              player.moveDirection = { dx: -dx, dy: -dy };
            } else if (nextCell.type === 'rotate-left') {
              player.moveDirection = { dx: dy, dy: -dx };
            } else if (nextCell.type === 'rotate-right') {
              player.moveDirection = { dx: -dy, dy: dx };
            }

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
  if (!gameStarted || gamePaused) return;

    if (!player.moveDirection || player.onSticky) {
      player.moveDirection = { dx, dy };
      player.onSticky = false; // reset sticky flag after turning
      moveCount++;
      updateGameStats();
    }
}

// Resets runtime state only; the level layout is preserved
function resetGame() {
  exportPlaytestGrid = null;
  restoreAttemptSpikes();
  setStatus('');
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
  gameStarted = false;
  player = null;
  clearGameStats();
  renderGrid();
}

function clearLevel() {
  if (!confirm('Clear the entire level? This cannot be undone.')) return;

  exportPlaytestPassed = false;
  resetGame();
  for (const row of grid) {
    for (const cell of row) cell.type = 'wall';
  }
  undoStack.length = 0;
  redoStack.length = 0;
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

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.error(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}

let helpOverlay = null;

function closeHelp() {
  if (helpOverlay) {
    helpOverlay.remove();
    helpOverlay = null;
  }
}

function showHelp() {
  if (helpOverlay) return;

  let style = document.getElementById('slidtrix-help-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'slidtrix-help-style';
    style.textContent = `
    .help-overlay {
      position: fixed; inset: 0; z-index: 1000;
      display: flex; align-items: center; justify-content: center;
      padding: 20px; background: rgba(0, 0, 0, 0.85);
      color: #0f0; font-family: sans-serif;
    }
    .help-panel {
      position: relative; width: min(600px, 100%); max-height: 85vh;
      overflow-y: auto; padding: 24px; border: 1px solid #0f0;
      background: #080808; box-sizing: border-box;
    }
    .help-panel h2 { margin-top: 0; color: #0f0; }
    .help-panel h3 { margin-bottom: 6px; color: #0f0; }
    .help-panel p, .help-panel li { line-height: 1.5; }
    .help-panel kbd { color: #fff; }
    .help-close {
      position: absolute; top: 12px; right: 12px; cursor: pointer;
      color: #0f0; background: #111; border: 1px solid #0f0;
      padding: 6px 10px;
    }
  `;
    document.head.appendChild(style);
  }

  helpOverlay = document.createElement('div');
  helpOverlay.className = 'help-overlay';
  helpOverlay.setAttribute('role', 'dialog');
  helpOverlay.setAttribute('aria-modal', 'true');
  helpOverlay.setAttribute('aria-label', 'Slidtrix guide');
  helpOverlay.innerHTML = `
    <section class="help-panel">
      <button class="help-close" type="button" aria-label="Close guide">Close</button>
      <h2>SLIDTRIX GUIDE</h2>
      <p>Build a level in the editor, start at "<strong>*</strong>", and reach "<strong>~</strong>".</p>
      <h3>Controls</h3>
      <ul>
        <li><kbd>Tab</kbd> — start the level (requires exactly one start tile).</li>
        <li><kbd>Arrow keys</kbd> — choose a direction. The player slides until blocked; input works while stopped or on sticky tiles.</li>
        <li><kbd>R</kbd> — reset the current attempt; <kbd>C</kbd> — clear the level (confirmation required).</li>
        <li><kbd>O</kbd> — open export verification (a playtest win is required); <kbd>P</kbd> — import a save code.</li>
        <li>Use the Level Library controls to browse, play, edit, delete, and export up to 25 saved levels; choose Save to Library to update the selected entry or Save as New to add another.</li>
        <li><kbd>+</kbd> or <kbd>=</kbd> — toggle fullscreen.</li>
        <li><kbd>Esc</kbd> — pause or resume during play; dismiss this guide when it is open.</li>
        <li><kbd>/</kbd> — open this guide; use the Close button to dismiss it.</li>
        <li>In the editor, left-click cycles tiles forward and right-click cycles backward; <kbd>Ctrl+Z</kbd> undoes and <kbd>Ctrl+Y</kbd> redoes edits.</li>
      </ul>
      <h3>Tiles</h3>
      <ul class="help-tiles"></ul>
    </section>
  `;

  const tileDescriptions = {
    wall: 'Blocks movement; the player stops before it.',
    floor: 'Safe space to cross.',
    start: 'The player begins here.',
    end: 'Win by coming to a stop on it.',
    sticky: 'Stops the player and allows a new direction.',
    'conveyor-up': 'Pushes the player up one tile while stopped.',
    'conveyor-down': 'Pushes the player down one tile while stopped.',
    'conveyor-left': 'Pushes the player left one tile while stopped.',
    'conveyor-right': 'Pushes the player right one tile while stopped.',
    trap: 'Kills the player if they stop on it.',
    lava: 'Kills immediately on entry.',
    spikes: 'Turns into lava when the player leaves it.',
    'cracked-floor': 'Turns into a wall when the player leaves it.',
    bumper: 'Reverses the player’s direction on entry.',
    'rotate-left': 'Turns the player’s direction 90° counterclockwise on entry.',
    'rotate-right': 'Turns the player’s direction 90° clockwise on entry.',
    portal: 'Teleports between a pair; use either zero or exactly two portals.'
  };

  const tileList = helpOverlay.querySelector('.help-tiles');
  TILE_TYPES.forEach(tile => {
    const item = document.createElement('li');
    const symbol = document.createElement('strong');
    symbol.textContent = tile.symbol;
    symbol.style.color = tile.color;
    item.append(symbol, ` ${tile.type} — ${tileDescriptions[tile.type] || 'Special tile.'}`);
    tileList.appendChild(item);
  });

  document.body.appendChild(helpOverlay);
  helpOverlay.querySelector('.help-close').addEventListener('click', closeHelp);
  helpOverlay.addEventListener('click', (event) => {
    if (event.target === helpOverlay) closeHelp();
  });
}

let editorSecretSequence = '';
const EDITOR_SECRET = 'slidtrix';

function randomizeLevel() {
  if (gameStarted) return;

  const types = TILE_TYPES.map(tile => tile.type).filter(type => type !== 'start' && type !== 'end' && type !== 'portal');
  const positions = Array.from({ length: gridSize * gridSize }, (_, index) => index);
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      grid[y][x].type = types[Math.floor(Math.random() * types.length)];
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  const startIndex = positions.pop();
  const endIndex = positions.pop();
  grid[Math.floor(startIndex / gridSize)][startIndex % gridSize].type = 'start';
  grid[Math.floor(endIndex / gridSize)][endIndex % gridSize].type = 'end';

  if (Math.random() < 0.5) {
    const firstPortal = positions.pop();
    const secondPortal = positions.pop();
    grid[Math.floor(firstPortal / gridSize)][firstPortal % gridSize].type = 'portal';
    grid[Math.floor(secondPortal / gridSize)][secondPortal % gridSize].type = 'portal';
  }

  undoStack.length = 0;
  redoStack.length = 0;
  exportPlaytestGrid = null;
  exportPlaytestPassed = false;
  renderGrid();
  setStatus('Level randomized!');
}

document.addEventListener('keydown', (e) => {
  if (gameStarted || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) {
    editorSecretSequence = '';
  } else {
    editorSecretSequence = (editorSecretSequence + e.key.toLowerCase()).slice(-EDITOR_SECRET.length);
    if (editorSecretSequence === EDITOR_SECRET) {
      editorSecretSequence = '';
      randomizeLevel();
      return;
    }
  }

  if (e.ctrlKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
    e.preventDefault();
    if (gameStarted) return;
    if (e.key.toLowerCase() === 'z') undoTileEdit();
    else redoTileEdit();
    return;
  }

  if (e.key === '/') {
    e.preventDefault();
    showHelp();
    return;
  }
  if (e.key === 'Escape' && helpOverlay) {
    closeHelp();
    e.stopImmediatePropagation();
    return;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && gameStarted && !e.repeat &&
      !document.querySelector('.help-overlay, .library-overlay, .verify-overlay, .export-overlay')) {
    e.preventDefault();
    toggleGamePause();
    return;
  }

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

    // Starting again with Tab begins a fresh attempt, so restore temporary lava.
    restoreAttemptSpikes();
    player = { x: starts[0].x, y: starts[0].y, moveDirection: null, onSticky: false };
    startGameStats();
    gameStarted = true;
    renderGrid();
    startTickLoop();
    return;
  }

  if (e.key === 'r' || e.key === 'R') {
    resetGame();
    return;
  }

  if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    clearLevel();
    return;
  }

  if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    toggleFullscreen();
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
let currentLibraryId = null;
const LEVEL_LIBRARY_KEY = 'slidtrix-level-library-v1';
const MAX_LIBRARY_LEVELS = 25;
let exportPlaytestGrid = null;
let exportPlaytestPassed = false;
let recentlyExportedLevel = null;

function exportLevel() {
  if (gameStarted) return;

  const starts = findAllStarts();
  const ends = grid.flat().filter(cell => cell.type === 'end');
  const portalCount = grid.flat().filter(cell => cell.type === 'portal').length;
  const checks = [
    { label: 'Exactly one start', passed: starts.length === 1, detail: `${starts.length} found` },
    { label: 'Exactly one end', passed: ends.length === 1, detail: `${ends.length} found` },
    { label: 'Zero or two portals', passed: portalCount === 0 || portalCount === 2, detail: `${portalCount} found` },
    {
      label: 'Clear check',
      passed: exportPlaytestPassed,
      detail: exportPlaytestPassed
        ? 'Level completed in playtest mode.'
        : 'Complete the level in playtest mode to verify it.'
    }
  ];
  const passedStructureChecks = checks.slice(0, 3).every(check => check.passed);

  let style = document.getElementById('slidtrix-verify-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'slidtrix-verify-style';
    style.textContent = `
      .verify-overlay { position: fixed; inset: 0; z-index: 1001; display: flex;
        align-items: center; justify-content: center; padding: 20px;
        background: rgba(0, 0, 0, .85); color: #0f0; font-family: sans-serif; }
      .verify-panel { width: min(480px, 100%); padding: 24px; border: 1px solid #0f0;
        background: #080808; box-sizing: border-box; }
      .verify-panel h2 { margin-top: 0; color: #0f0; }
      .verify-list { padding-left: 22px; line-height: 1.8; }
      .verify-pass { color: #0f0; }
      .verify-fail { color: #f66; }
      .verify-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
      .verify-actions button { padding: 8px 12px; color: #0f0; background: #111; border: 1px solid #0f0; cursor: pointer; }
      .verify-actions button:disabled { color: #777; border-color: #555; cursor: not-allowed; }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'verify-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Level verification');
  const panel = document.createElement('section');
  panel.className = 'verify-panel';
  const heading = document.createElement('h2');
  heading.textContent = 'LEVEL VERIFICATION';
  const list = document.createElement('ul');
  list.className = 'verify-list';
  checks.forEach(check => {
    const item = document.createElement('li');
    item.className = check.passed ? 'verify-pass' : 'verify-fail';
    item.textContent = `${check.passed ? '✓' : '✗'} ${check.label} — ${check.detail}`;
    list.appendChild(item);
  });
  const actions = document.createElement('div');
  actions.className = 'verify-actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', () => overlay.remove());
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.textContent = exportPlaytestPassed ? 'Continue to Export' : 'Playtest Level';
  exportButton.disabled = !passedStructureChecks;
  exportButton.addEventListener('click', () => {
    overlay.remove();
    if (exportPlaytestPassed) promptForLevelExport();
    else beginExportPlaytest();
  });
  actions.append(cancelButton, exportButton);
  panel.append(heading, list, actions);
  overlay.appendChild(panel);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function beginExportPlaytest() {
  const starts = findAllStarts();
  if (gameStarted || starts.length !== 1 || !validatePortals()) return;

  exportPlaytestGrid = JSON.stringify(grid.map(row => row.map(cell => cell.type)));
  exportPlaytestPassed = false;
  player = { x: starts[0].x, y: starts[0].y, moveDirection: null, onSticky: false };
  startGameStats();
  gameStarted = true;
  setStatus('Playtest: complete the level to pass the clear check.');
  renderGrid();
  startTickLoop();
}

function openLevelExportDialog(data, onDetailsChange = () => {}, onSave = null, headingText = 'EXPORT LEVEL', onCodeGenerated = () => {}, onSaveNew = null, showCode = true) {
  document.querySelector('.export-overlay')?.remove();
  let style = document.getElementById('slidtrix-export-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'slidtrix-export-style';
    style.textContent = `
      .export-overlay { position: fixed; inset: 0; z-index: 1003; display: flex; align-items: center;
        justify-content: center; padding: 16px; background: rgba(0,0,0,.88); color: #0f0; font-family: sans-serif; }
      .export-panel { width: min(520px,100%); padding: 22px; border: 1px solid #0f0;
        background: #080808; box-sizing: border-box; }
      .export-panel h2 { color: #0f0; margin-top: 0; }
      .export-panel label { display: block; margin: 12px 0 5px; }
      .export-panel input, .export-panel textarea { width: 100%; box-sizing: border-box; padding: 9px;
        color: #0f0; background: #111; border: 1px solid #456; font: inherit; }
      .export-panel textarea { min-height: 100px; resize: vertical; }
      .export-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      .export-actions button { padding: 8px 12px; color: #0f0; background: #111; border: 1px solid #0f0; cursor: pointer; }
      .export-message { min-height: 1.2em; color: #aaa; }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'export-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', headingText);
  const panel = document.createElement('section');
  panel.className = 'export-panel';
  panel.innerHTML = `
    <h2>${headingText}</h2>
    <label for="export-title">Level title</label>
    <input id="export-title" type="text">
    <label for="export-author">Author</label>
    <input id="export-author" type="text">
    ${showCode ? '<label for="export-code">Level code</label>' : ''}
    ${showCode ? '<textarea id="export-code" readonly></textarea>' : ''}
    <p class="export-message" aria-live="polite"></p>
    <div class="export-actions">
      <button type="button" class="export-close">Close</button>
      ${showCode ? '<button type="button" class="export-copy">Copy code</button>' : ''}
      ${onSave ? '<button type="button" class="export-save">Save to Library</button>' : ''}
      ${onSaveNew ? '<button type="button" class="export-save-new">Save as New</button>' : ''}
    </div>
  `;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const titleInput = panel.querySelector('#export-title');
  const authorInput = panel.querySelector('#export-author');
  const codeInput = panel.querySelector('#export-code');
  const message = panel.querySelector('.export-message');
  let generatedCode = '';
  titleInput.value = data.title || '';
  authorInput.value = data.author || '';

  const updateCode = () => {
    data.title = titleInput.value;
    data.author = authorInput.value;
    onDetailsChange(data.title, data.author);
    generatedCode = encodeBase64Unicode(JSON.stringify(data));
    if (codeInput) codeInput.value = generatedCode;
    onCodeGenerated(generatedCode);
    message.textContent = '';
  };
  titleInput.addEventListener('input', updateCode);
  authorInput.addEventListener('input', updateCode);
  updateCode();

  panel.querySelector('.export-close').addEventListener('click', () => overlay.remove());
  if (onSave) {
    panel.querySelector('.export-save').addEventListener('click', () => {
      if (onSave(generatedCode)) overlay.remove();
    });
  }
  if (onSaveNew) {
    panel.querySelector('.export-save-new').addEventListener('click', () => {
      if (onSaveNew(generatedCode)) overlay.remove();
    });
  }
  const copyButton = panel.querySelector('.export-copy');
  if (copyButton) copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeInput.value);
      message.textContent = 'Level code copied to clipboard.';
    } catch {
      message.textContent = 'Could not access the clipboard. Select and copy the code above.';
      codeInput.focus();
      codeInput.select();
    }
  });
  overlay.addEventListener('click', event => {
    if (event.target === overlay) overlay.remove();
  });
}

function promptForLevelExport() {
  const data = {
    title: levelTitle,
    author: levelAuthor,
    grid: grid.map(row => row.map(cell => cell.type))
  };
  openLevelExportDialog(data, (title, author) => {
    levelTitle = title;
    levelAuthor = author;
    updateLevelMeta();
    
  }, null, 'EXPORT LEVEL', code => {
    recentlyExportedLevel = {
      code,
      grid: JSON.stringify(data.grid),
      libraryId: currentLibraryId
    };
  });
}

function loadFromCode(code) {
  importLevelCode(code);
}

function updateLevelMeta() {
  const metaEl = document.getElementById('level-meta');
  if (metaEl) metaEl.textContent = levelTitle ? `${levelTitle} By: ${levelAuthor}` : '';
}

function readLevelLibrary() {
  try {
    const levels = JSON.parse(localStorage.getItem(LEVEL_LIBRARY_KEY) || '[]');
    return Array.isArray(levels) ? levels : [];
  } catch {
    return [];
  }
}

function writeLevelLibrary(levels) {
  if (levels.length > MAX_LIBRARY_LEVELS) {
    alert(`Your level library is full. It can store up to ${MAX_LIBRARY_LEVELS} levels; delete one before adding another.`);
    return false;
  }
  try {
    localStorage.setItem(LEVEL_LIBRARY_KEY, JSON.stringify(levels));
    return true;
  } catch {
    alert('Could not save the level library in this browser.');
    return false;
  }
}

function makeLevelId() {
  return globalThis.crypto?.randomUUID?.() || `level-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isValidLevelGrid(candidate) {
  return Array.isArray(candidate) && candidate.length === gridSize &&
    candidate.every(row => Array.isArray(row) && row.length === gridSize &&
      row.every(type => TILE_TYPES.some(tile => tile.type === type)));
}

function importLevelCode(code) {
  try {
    const data = JSON.parse(decodeBase64Unicode(code.trim()));
    if (!data || !isValidLevelGrid(data.grid)) throw new Error('Invalid level grid');
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Untitled Level';
    const author = typeof data.author === 'string' && data.author.trim() ? data.author.trim() : 'Unknown';
    const library = readLevelLibrary();
    const duplicate = library.find(level => level.title === title && level.author === author &&
      JSON.stringify(level.grid) === JSON.stringify(data.grid));
    if (duplicate) {
      openLevelLibrary();
      setStatus(`“${title}” is already in your library.`);
      return;
    }

    const entry = {
      id: makeLevelId(), title, author,
      grid: data.grid.map(row => row.slice()),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!writeLevelLibrary([...library, entry])) return;
    setStatus(`Imported “${title}” to your level library.`);
    openLevelLibrary();
  } catch {
    alert('Invalid save code or level data!');
  }
}

function loadLibraryLevel(entry, mode) {
  if (!entry || !isValidLevelGrid(entry.grid)) {
    alert('This library entry has invalid level data.');
    return;
  }
  resetGame();
  entry.grid.forEach((row, y) => row.forEach((type, x) => { grid[y][x].type = type; }));
  levelTitle = entry.title || 'Untitled Level';
  levelAuthor = entry.author || 'Unknown';
  currentLibraryId = entry.id;
  undoStack.length = 0;
  redoStack.length = 0;
  exportPlaytestPassed = false;
  renderGrid();
  updateLevelMeta();

  if (mode === 'play') {
    const starts = findAllStarts();
    if (starts.length !== 1 || !validatePortals()) {
      setStatus('This level needs exactly one start and zero or two portals to play.');
      return;
    }
    player = { x: starts[0].x, y: starts[0].y, moveDirection: null, onSticky: false };
    startGameStats();
    gameStarted = true;
    renderGrid();
    startTickLoop();
    setStatus(`Playing “${levelTitle}”.`);
  } else {
    setStatus(`Editing “${levelTitle}”. Use Save to Library to keep your changes.`);
  }
}

function saveLevelDataToLibrary(data, saveAsNew = false) {
  if (!data || !isValidLevelGrid(data.grid)) {
    alert('This level has invalid data and could not be saved.');
    return false;
  }

  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Untitled Level';
  const author = typeof data.author === 'string' && data.author.trim() ? data.author.trim() : 'Unknown';
  const savedGrid = data.grid.map(row => row.slice());
  const library = readLevelLibrary();
  let entry = saveAsNew ? null : library.find(level => level.id === currentLibraryId);
  if (!entry && !saveAsNew) {
    entry = library.find(level => level.title === title && level.author === author &&
      JSON.stringify(level.grid) === JSON.stringify(savedGrid));
  }

  if (!entry && library.length >= MAX_LIBRARY_LEVELS) {
    alert(`Your level library is full. It can store up to ${MAX_LIBRARY_LEVELS} levels; delete one before adding another.`);
    return false;
  }

  const now = new Date().toISOString();
  if (entry) {
    entry.title = title;
    entry.author = author;
    entry.grid = savedGrid;
    entry.updatedAt = now;
  } else {
    entry = {
      id: makeLevelId(), title, author, grid: savedGrid,
      createdAt: now, updatedAt: now
    };
    library.push(entry);
  }

  if (!writeLevelLibrary(library)) return false;
  currentLibraryId = entry.id;
  levelTitle = entry.title;
  levelAuthor = entry.author;
  exportPlaytestGrid = null;
  exportPlaytestPassed = false;
  updateLevelMeta();
  setStatus(`Saved “${entry.title}” to your level library.`);
  return true;
}

function saveLevelCodeToLibrary(code, saveAsNew = false) {
  try {
    const data = JSON.parse(decodeBase64Unicode(code));
    return saveLevelDataToLibrary(data, saveAsNew);
  } catch {
    alert('The generated level code could not be saved.');
    return false;
  }
}

function saveCurrentToLibrary() {
  if (gameStarted) {
    setStatus('Stop the current game before saving to the library.');
    return;
  }

  const data = {
    title: levelTitle,
    author: levelAuthor,
    grid: grid.map(row => row.map(cell => cell.type))
  };
  openLevelExportDialog(data, (title, author) => {
    levelTitle = title;
    levelAuthor = author;
    updateLevelMeta();
  }, code => saveLevelCodeToLibrary(code), 'SAVE TO LIBRARY', () => {  }, code => saveLevelCodeToLibrary(code, true), false);
}

function openLevelLibrary() {
  document.querySelector('.library-overlay')?.remove();
  let style = document.getElementById('slidtrix-library-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'slidtrix-library-style';
    style.textContent = `
      .library-overlay { position: fixed; inset: 0; z-index: 1002; display: flex; align-items: center;
        justify-content: center; padding: 16px; background: rgba(0,0,0,.88); color: #0f0; font-family: sans-serif; }
      .library-panel { position: relative; width: min(760px,100%); max-height: 90vh; overflow-y: auto;
        padding: 22px; border: 1px solid #0f0; background: #080808; box-sizing: border-box; }
      .library-panel h2 { color: #0f0; margin-top: 0; }
      .library-close { float: right; }
      .library-entry { display: flex; align-items: center; gap: 14px; padding: 12px 0; border-top: 1px solid #285528; }
      .library-entry-info { flex: 1; min-width: 150px; }
      .library-entry-info strong { display: block; }
      .library-entry-info small { color: #aaa; }
      .library-preview { display: grid; grid-template-columns: repeat(10, 9px); gap: 1px; flex: none; }
      .library-preview span { width: 9px; height: 9px; font-size: 8px; line-height: 9px; text-align: center; }
      .library-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .library-panel button { padding: 6px 9px; color: #0f0; background: #111; border: 1px solid #0f0; cursor: pointer; }
      .library-empty { color: #aaa; }
      @media (max-width: 560px) { .library-entry { align-items: flex-start; flex-wrap: wrap; } }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'library-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Level library');
  const panel = document.createElement('section');
  panel.className = 'library-panel';
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'library-close'; close.textContent = 'Close';
  close.addEventListener('click', () => overlay.remove());
  const heading = document.createElement('h2'); heading.textContent = 'LEVEL LIBRARY';
  panel.append(close, heading);

  const library = readLevelLibrary();
  if (!library.length) {
    const empty = document.createElement('p');
    empty.className = 'library-empty';
    empty.textContent = 'Your library is empty. Import a level code or save the level you are editing.';
    panel.appendChild(empty);
  }
  library.forEach(entry => {
    const row = document.createElement('article'); row.className = 'library-entry';
    const preview = document.createElement('div'); preview.className = 'library-preview';
    if (isValidLevelGrid(entry.grid)) {
      entry.grid.forEach(line => line.forEach(type => {
        const cell = document.createElement('span');
        const tile = getTileDefinition(type);
        cell.textContent = tile.symbol; cell.style.color = tile.color;
        preview.appendChild(cell);
      }));
    }
    const info = document.createElement('div'); info.className = 'library-entry-info';
    const name = document.createElement('strong'); name.textContent = entry.title || 'Untitled Level';
    const author = document.createElement('small'); author.textContent = `By ${entry.author || 'Unknown'}`;
    info.append(name, author);
    const actions = document.createElement('div'); actions.className = 'library-actions';
    const addAction = (label, action, danger = false) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      if (danger) button.style.color = '#f88';
      button.addEventListener('click', action); actions.appendChild(button);
    };
    addAction('Play', () => { overlay.remove(); loadLibraryLevel(entry, 'play'); });
    addAction('Edit', () => { overlay.remove(); loadLibraryLevel(entry, 'edit'); });
    addAction('Delete', () => {
      if (!confirm(`Delete “${entry.title}” from your library?`)) return;
      const remaining = readLevelLibrary().filter(level => level.id !== entry.id);
      if (writeLevelLibrary(remaining)) {
        if (currentLibraryId === entry.id) currentLibraryId = null;
        openLevelLibrary();
      }
    }, true);
    row.append(preview, info, actions); panel.appendChild(row);
  });
  overlay.appendChild(panel);
  overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function requestLevelImport() {
  const code = prompt('Paste a level save code:');
  if (code) importLevelCode(code);
}

document.getElementById('open-library').addEventListener('click', openLevelLibrary);
document.getElementById('import-level').addEventListener('click', requestLevelImport);
document.getElementById('save-to-library').addEventListener('click', saveCurrentToLibrary);
pauseButton.addEventListener('click', toggleGamePause);
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveCurrentToLibrary();
  }
  if (event.key === 'Escape') document.querySelector('.library-overlay')?.remove();
});

// Attach hotkeys **after** functions exist
document.addEventListener('keydown', (e) => {
  if (e.key === 'o' || e.key === 'O') {
    exportLevel();
  } else if ((e.key === 'p' || e.key === 'P') && !gameStarted) {
    const code = prompt('Paste your save code:');
    if (code) loadFromCode(code);
  }
});