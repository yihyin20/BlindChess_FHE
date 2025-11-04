pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BlindChess is ZamaEthereumConfig {
    struct EncryptedPiece {
        euint32 position;
        uint8 pieceType;
        bool isWhite;
        bool isCaptured;
    }

    struct MoveProof {
        euint32 fromPosition;
        euint32 toPosition;
        bytes moveProof;
    }

    address public whitePlayer;
    address public blackPlayer;
    uint256 public turnCount;
    bool public gameActive;

    mapping(uint8 => EncryptedPiece) public board;
    mapping(address => bool) public playerRegistered;

    event GameStarted(address whitePlayer, address blackPlayer);
    event MoveMade(uint8 pieceId, euint32 fromPosition, euint32 toPosition);
    event GameOver(uint8 winner);

    modifier onlyPlayer() {
        require(msg.sender == whitePlayer || msg.sender == blackPlayer, "Not a player");
        _;
    }

    modifier validTurn() {
        require(gameActive, "Game not active");
        _;
    }

    constructor() ZamaEthereumConfig() {
        gameActive = false;
    }

    function registerPlayer() external {
        require(!playerRegistered[msg.sender], "Already registered");
        require(whitePlayer == address(0) || blackPlayer == address(0), "Game full");

        if (whitePlayer == address(0)) {
            whitePlayer = msg.sender;
        } else {
            blackPlayer = msg.sender;
        }

        playerRegistered[msg.sender] = true;

        if (whitePlayer != address(0) && blackPlayer != address(0)) {
            gameActive = true;
            emit GameStarted(whitePlayer, blackPlayer);
        }
    }

    function initializeBoard(
        uint8 pieceId,
        externalEuint32 position,
        bytes calldata positionProof,
        uint8 pieceType,
        bool isWhite
    ) external onlyPlayer {
        require(gameActive, "Game not active");
        require(board[pieceId].position == euint32(0), "Piece already initialized");

        board[pieceId] = EncryptedPiece({
            position: FHE.fromExternal(position, positionProof),
            pieceType: pieceType,
            isWhite: isWhite,
            isCaptured: false
        });

        FHE.allowThis(board[pieceId].position);
        FHE.makePubliclyDecryptable(board[pieceId].position);
    }

    function makeMove(
        uint8 pieceId,
        MoveProof calldata move
    ) external onlyPlayer validTurn {
        EncryptedPiece storage piece = board[pieceId];
        require(!piece.isCaptured, "Piece is captured");
        require(isValidMove(piece, move), "Invalid move");

        // Homomorphic verification of move legality
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(piece.position);
        cts[1] = FHE.toBytes32(move.toPosition);

        bytes memory moveVerificationProof = abi.encodePacked(move.moveProof);
        FHE.checkSignatures(cts, abi.encode(moveVerificationProof), move.moveProof);

        // Update piece position
        piece.position = move.toPosition;

        turnCount++;
        emit MoveMade(pieceId, move.fromPosition, move.toPosition);

        if (isCheckmate()) {
            gameActive = false;
            emit GameOver(turnCount % 2 == 0 ? 1 : 2);
        }
    }

    function isValidMove(EncryptedPiece storage piece, MoveProof calldata move) internal view returns (bool) {
        // Basic move validation logic
        if (piece.isWhite && turnCount % 2 == 1) return false;
        if (!piece.isWhite && turnCount % 2 == 0) return false;

        // Additional game-specific move validation would go here
        return true;
    }

    function isCheckmate() internal view returns (bool) {
        // Simplified checkmate detection logic
        // In a real implementation, this would be more complex
        return turnCount >= 100; // Example condition
    }

    function resign() external onlyPlayer validTurn {
        gameActive = false;
        emit GameOver(msg.sender == whitePlayer ? 2 : 1);
    }

    function getBoardState() external view returns (EncryptedPiece[] memory) {
        EncryptedPiece[] memory state = new EncryptedPiece[](32);
        for (uint8 i = 0; i < 32; i++) {
            state[i] = board[i];
        }
        return state;
    }

    function getCurrentTurn() external view returns (address) {
        return turnCount % 2 == 0 ? whitePlayer : blackPlayer;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


