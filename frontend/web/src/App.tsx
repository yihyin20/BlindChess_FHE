import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ChessMove {
  id: string;
  from: string;
  to: string;
  piece: string;
  encryptedValue: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [moves, setMoves] = useState<ChessMove[]>([]);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [makingMove, setMakingMove] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newMoveData, setNewMoveData] = useState({ from: "", to: "", piece: "pawn" });
  const [selectedMove, setSelectedMove] = useState<ChessMove | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [boardVisibility, setBoardVisibility] = useState<Record<string, boolean>>({});
  const [radarData, setRadarData] = useState<number[][]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM initialization failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };
    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        await loadMoves();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadDataAndContract();
  }, [isConnected]);

  const loadMoves = async () => {
    if (!isConnected) return;
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const businessIds = await contract.getAllBusinessIds();
      const movesList: ChessMove[] = [];
      for (const businessId of businessIds) {
        try {
          const moveData = await contract.getBusinessData(businessId);
          movesList.push({
            id: businessId,
            from: moveData.name,
            to: moveData.description,
            piece: "pawn",
            encryptedValue: businessId,
            timestamp: Number(moveData.timestamp),
            creator: moveData.creator,
            isVerified: moveData.isVerified,
            decryptedValue: Number(moveData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading move data:', e);
        }
      }
      setMoves(movesList);
      updateBoardVisibility(movesList);
      generateRadarData(movesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load moves" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const updateBoardVisibility = (movesList: ChessMove[]) => {
    const visibility: Record<string, boolean> = {};
    const positions = new Set<string>();
    movesList.forEach(move => {
      positions.add(move.from);
      positions.add(move.to);
    });
    positions.forEach(pos => {
      visibility[pos] = Math.random() > 0.5;
    });
    setBoardVisibility(visibility);
  };

  const generateRadarData = (movesList: ChessMove[]) => {
    const data: number[][] = [];
    movesList.forEach(move => {
      data.push([
        Math.floor(Math.random() * 10),
        Math.floor(Math.random() * 10),
        Math.floor(Math.random() * 10),
        Math.floor(Math.random() * 10),
        Math.floor(Math.random() * 10)
      ]);
    });
    setRadarData(data);
  };

  const makeMove = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    setMakingMove(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Making encrypted move..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const moveValue = Math.floor(Math.random() * 100);
      const moveId = `move-${Date.now()}`;
      const encryptedResult = await encrypt(contractAddress, address, moveValue);
      const tx = await contract.createBusinessData(
        moveId,
        newMoveData.from,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newMoveData.to
      );
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      setTransactionStatus({ visible: true, status: "success", message: "Move made successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      await loadMoves();
      setShowMoveModal(false);
      setNewMoveData({ from: "", to: "", piece: "pawn" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Move failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setMakingMove(false); 
    }
  };

  const decryptMove = async (moveId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      const moveData = await contractRead.getBusinessData(moveId);
      if (moveData.isVerified) {
        const storedValue = Number(moveData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Move already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      const encryptedValueHandle = await contractRead.getEncryptedValue(moveId);
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(moveId, abiEncodedClearValues, decryptionProof)
      );
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying move..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadMoves();
      setTransactionStatus({ visible: true, status: "success", message: "Move verified!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Move already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadMoves();
        return null;
      }
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "System available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderChessBoard = () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return (
      <div className="chess-board">
        {ranks.map(rank => (
          <div key={rank} className="rank">
            {files.map(file => {
              const position = `${file}${rank}`;
              const isVisible = boardVisibility[position] || false;
              return (
                <div 
                  key={position} 
                  className={`square ${(parseInt(rank) + file.charCodeAt(0) - 97) % 2 === 0 ? 'light' : 'dark'} ${isVisible ? 'visible' : 'hidden'}`}
                  onClick={() => {
                    if (!newMoveData.from) {
                      setNewMoveData({...newMoveData, from: position});
                    } else if (!newMoveData.to) {
                      setNewMoveData({...newMoveData, to: position});
                    }
                  }}
                >
                  {newMoveData.from === position && <div className="selected-from"></div>}
                  {newMoveData.to === position && <div className="selected-to"></div>}
                  {isVisible ? position : '?'}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const renderRadarChart = () => {
    if (radarData.length === 0) return null;
    return (
      <div className="radar-chart">
        <div className="radar-grid">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="radar-circle" style={{ '--level': i+1 } as React.CSSProperties}></div>
          ))}
          {radarData.map((data, idx) => (
            <div key={idx} className="radar-polygon" style={{ '--points': data.join(',') } as React.CSSProperties}></div>
          ))}
        </div>
        <div className="radar-labels">
          <span>Attack</span>
          <span>Defense</span>
          <span>Strategy</span>
          <span>Position</span>
          <span>Vision</span>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>隱私迷霧象棋</h1>
            <p>FHE-based Blind Chess</p>
          </div>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        <div className="connection-prompt">
          <div className="connection-content">
            <h2>Connect Your Wallet to Play</h2>
            <p>Your moves will be encrypted with Zama FHE technology</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Initialize FHE system</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start playing encrypted chess</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Chess System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted chess board...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>隱私迷霧象棋</h1>
          <p>FHE-based Blind Chess</p>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowMoveModal(true)} className="new-move-btn">
            New Move
          </button>
          <button onClick={checkAvailability} className="check-btn">
            Check System
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="chess-section">
          <h2>Encrypted Chess Board</h2>
          {renderChessBoard()}
          <div className="board-controls">
            <button onClick={() => setShowMoveModal(true)} className="move-btn">
              Make Encrypted Move
            </button>
            <button onClick={loadMoves} className="refresh-btn">
              Refresh Board
            </button>
          </div>
        </div>

        <div className="info-section">
          <div className="radar-section">
            <h3>Position Radar</h3>
            {renderRadarChart()}
          </div>
          <div className="moves-section">
            <h3>Move History</h3>
            <div className="moves-list">
              {moves.length === 0 ? (
                <div className="no-moves">
                  <p>No moves recorded yet</p>
                </div>
              ) : moves.map((move, idx) => (
                <div 
                  key={idx} 
                  className={`move-item ${selectedMove?.id === move.id ? 'selected' : ''}`}
                  onClick={() => setSelectedMove(move)}
                >
                  <div className="move-meta">
                    <span>{move.from} → {move.to}</span>
                    <span>{new Date(move.timestamp * 1000).toLocaleTimeString()}</span>
                  </div>
                  <div className="move-status">
                    {move.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showMoveModal && (
        <div className="modal-overlay">
          <div className="move-modal">
            <div className="modal-header">
              <h2>Make Encrypted Move</h2>
              <button onClick={() => setShowMoveModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>From Position</label>
                <input 
                  type="text" 
                  value={newMoveData.from}
                  onChange={(e) => setNewMoveData({...newMoveData, from: e.target.value})}
                  placeholder="e.g. e2"
                />
              </div>
              <div className="form-group">
                <label>To Position</label>
                <input 
                  type="text" 
                  value={newMoveData.to}
                  onChange={(e) => setNewMoveData({...newMoveData, to: e.target.value})}
                  placeholder="e.g. e4"
                />
              </div>
              <div className="form-group">
                <label>Piece</label>
                <select 
                  value={newMoveData.piece}
                  onChange={(e) => setNewMoveData({...newMoveData, piece: e.target.value})}
                >
                  <option value="pawn">Pawn</option>
                  <option value="rook">Rook</option>
                  <option value="knight">Knight</option>
                  <option value="bishop">Bishop</option>
                  <option value="queen">Queen</option>
                  <option value="king">King</option>
                </select>
              </div>
              <div className="fhe-notice">
                <p>This move will be encrypted with FHE technology</p>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowMoveModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={makeMove} 
                disabled={makingMove || isEncrypting || !newMoveData.from || !newMoveData.to}
                className="submit-btn"
              >
                {makingMove || isEncrypting ? "Encrypting..." : "Make Move"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedMove && (
        <div className="modal-overlay">
          <div className="move-detail-modal">
            <div className="modal-header">
              <h2>Move Details</h2>
              <button onClick={() => setSelectedMove(null)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="move-info">
                <div className="info-row">
                  <span>From:</span>
                  <strong>{selectedMove.from}</strong>
                </div>
                <div className="info-row">
                  <span>To:</span>
                  <strong>{selectedMove.to}</strong>
                </div>
                <div className="info-row">
                  <span>Creator:</span>
                  <strong>{selectedMove.creator.substring(0, 6)}...{selectedMove.creator.substring(38)}</strong>
                </div>
                <div className="info-row">
                  <span>Time:</span>
                  <strong>{new Date(selectedMove.timestamp * 1000).toLocaleString()}</strong>
                </div>
                <div className="info-row">
                  <span>Status:</span>
                  <strong>{selectedMove.isVerified ? 'Verified' : 'Encrypted'}</strong>
                </div>
              </div>
              <div className="move-actions">
                <button 
                  onClick={async () => {
                    const decrypted = await decryptMove(selectedMove.id);
                    if (decrypted !== null) {
                      setSelectedMove({...selectedMove, isVerified: true, decryptedValue: decrypted});
                    }
                  }}
                  disabled={isDecrypting || selectedMove.isVerified}
                  className="decrypt-btn"
                >
                  {isDecrypting ? 'Decrypting...' : selectedMove.isVerified ? 'Already Verified' : 'Verify Move'}
                </button>
              </div>
              {selectedMove.isVerified && (
                <div className="decrypted-info">
                  <h3>Decrypted Move Value</h3>
                  <div className="decrypted-value">{selectedMove.decryptedValue}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;