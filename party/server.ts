import type * as Party from 'partykit/server';

type PlayerData = {
  number: Player;
  name: string;
};

type GameState = {
  pieces: GamePiece[];
  currentPlayer: Player;
  winner: Player | null;
  players: {
    [key: string]: PlayerData;
  };
};

type GamePiece = {
  id: number;
  player: Player;
  position: number;
};

type Player = 1 | 2;

export default class GameServer implements Party.Server {
  options: Party.ServerOptions = {
    hibernate: false,
  };

  constructor(readonly room: Party.Room) {
    this.initialize();
  }

  async initialize() {
    const initialState: GameState = {
      pieces: [],
      currentPlayer: 1,
      winner: null,
      players: {},
    };

    const state = await this.room.storage.get<GameState>('gameState');
    if (!state) {
      await this.room.storage.put('gameState', initialState);
    }
  }

  async getState(): Promise<GameState> {
    const state = await this.room.storage.get<GameState>('gameState');
    return (
      state || {
        pieces: [],
        currentPlayer: 1,
        winner: null,
        players: {},
      }
    );
  }

  async setState(state: GameState) {
    await this.room.storage.put('gameState', state);
  }

  async onConnect(conn: Party.Connection) {
    const state = await this.getState();
    // Assign player number if not already assigned
    if (Object.keys(state.players).length < 2) {
      const playerNumber = (Object.keys(state.players).length + 1) as Player;
      state.players[conn.id] = {
        number: playerNumber,
        name: `Player ${playerNumber}`, // Default name
      };
      await this.setState(state);

      // Initialize game if this is the second player
      if (Object.keys(state.players).length === 2) {
        // Only initialize if both players have names other than default
        const allPlayersNamed = Object.values(state.players).every(p => 
          p.name && !p.name.startsWith('Player ')
        );
        if (allPlayersNamed) {
          await this.initializeGame();
        }
      }
    }

    // Send current state to the connecting client
    conn.send(
      JSON.stringify({
        type: 'gameState',
        state,
        yourPlayer: state.players[conn.id],
      })
    );
  }

  async onMessage(message: string, sender: Party.Connection) {
    const data = JSON.parse(message);
    const state = await this.getState();

    switch (data.type) {
      case 'name':
        if (state.players[sender.id]) {
          state.players[sender.id].name = data.playerName;
          await this.setState(state);
          await this.broadcastState();
        }
        break;
      case 'move':
        await this.handleMove(data.piece, data.newPosition, sender.id, state);
        break;
      case 'reset':
        await this.initializeGame();
        break;
    }
  }

  private async initializeGame() {
    const availablePositions = Array.from({ length: 10 }, (_, i) => i);
    const shuffledPositions: number[] = [];

    for (let i = 0; i < 6; i++) {
      const randomIndex = Math.floor(Math.random() * availablePositions.length);
      shuffledPositions.push(availablePositions[randomIndex]);
      availablePositions.splice(randomIndex, 1);
    }

    const currentState = await this.getState();
    const newState: GameState = {
      pieces: [
        { id: 1, player: 1, position: shuffledPositions[0] },
        { id: 2, player: 1, position: shuffledPositions[1] },
        { id: 3, player: 1, position: shuffledPositions[2] },
        { id: 4, player: 2, position: shuffledPositions[3] },
        { id: 5, player: 2, position: shuffledPositions[4] },
        { id: 6, player: 2, position: shuffledPositions[5] },
      ],
      currentPlayer: 1,
      winner: null,
      players: currentState.players,
    };

    await this.setState(newState);
    await this.broadcastState();
  }

  private async handleMove(
    piece: GamePiece,
    newPosition: number,
    senderId: string,
    state: GameState
  ) {
    const playerNumber = state.players[senderId].number;

    if (
      state.winner ||
      piece.player !== state.currentPlayer ||
      playerNumber !== state.currentPlayer
    ) {
      return;
    }

    state.pieces = state.pieces.map((p) =>
      p.id === piece.id ? { ...p, position: newPosition } : p
    );

    const winner = this.checkWinner(state.pieces);
    if (winner) {
      state.winner = winner;
    } else {
      state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
    }

    await this.setState(state);
    await this.broadcastState();
  }

  private checkWinner(pieces: GamePiece[]): Player | null {
    const WINNING_COMBINATIONS = [
      [0, 1, 2], // Top Horizontal
      [8, 7, 9], // Top Middle Vertical
      [1, 3, 6], // Bottom Middle Vertical
      [3, 6, 7], // Bottom Horizontal
    ];

    for (const combo of WINNING_COMBINATIONS) {
      const piecesInCombo = pieces.filter((p) => combo.includes(p.position));
      if (
        piecesInCombo.length === 3 &&
        piecesInCombo.every((p) => p.player === piecesInCombo[0].player)
      ) {
        return piecesInCombo[0].player;
      }
    }
    return null;
  }

  private async broadcastState() {
    const state = await this.getState();
    this.room.broadcast(
      JSON.stringify({
        type: 'gameState',
        state,
      })
    );
  }

  async onClose(connection: Party.Connection) {
    const state = await this.getState();
    // Remove the disconnected player
    if (state.players[connection.id]) {
      delete state.players[connection.id];
      await this.setState(state);
      // Optionally reset the game when a player disconnects
      if (Object.keys(state.players).length < 2) {
        state.pieces = [];
        state.currentPlayer = 1;
        state.winner = null;
        await this.setState(state);
      }
      await this.broadcastState();
    }
  }
}
