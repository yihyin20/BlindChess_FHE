import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface ChessData {
  id: string;
  name: string;
  encryptedPosition: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  decryptedValue: number;
  isVerified: boolean;
}

interface ChessPiece {
  id: string;
  type: string;
  position: number;
  isEncrypted: boolean;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [chessData, setChessData] = useState<ChessData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPiece, setCreatingPiece] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPieceData, setNewPieceData] = useState({ name: "", position: "", description: "" });
  const [selectedPiece, setSelectedPiece] = useState<ChessData | null>(null);
  const [decryptedPosition, setDecryptedPosition] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("board");
  const [history, setHistory] = useState<string[]>([]);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

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
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
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
        await loadData();
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

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const dataList: ChessData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const data = await contract.getBusinessData(businessId);
          dataList.push({
            id: businessId,
            name: data.name,
            encryptedPosition: businessId,
            publicValue1: Number(data.publicValue1) || 0,
            publicValue2: Number(data.publicValue2) || 0,
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            decryptedValue: Number(data.decryptedValue) || 0,
            isVerified: data.isVerified
          });
        } catch (e) {
          console.error('Error loading data:', e);
        }
      }
      
      setChessData(dataList);
      addHistory("Loaded encrypted chess data");
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPiece = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPiece(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating piece with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const positionValue = parseInt(newPieceData.position) || 0;
      const businessId = `piece-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, positionValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPieceData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newPieceData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Piece created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPieceData({ name: "", position: "", description: "" });
      addHistory(`Created encrypted piece: ${newPieceData.name}`);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPiece(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const data = await contractRead.getBusinessData(businessId);
      if (data.isVerified) {
        const storedValue = Number(data.decryptedValue) || 0;
        setDecryptedPosition(storedValue);
        setTransactionStatus({ visible: true, status: "success", message: "Position verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying position..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      const position = Number(clearValue);
      setDecryptedPosition(position);
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Position decrypted!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      addHistory(`Decrypted position: ${position}`);
      return position;
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Position verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const renderChessBoard = () => {
    const boardSize = 8;
    const squares = [];
    
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const position = row * boardSize + col;
        const isDark = (row + col) % 2 === 1;
        
        let piece = null;
        chessData.forEach(data => {
          if (data.isVerified && data.decryptedValue === position) {
            piece = data.name;
          }
        });
        
        squares.push(
          <div 
            key={`${row}-${col}`} 
            className={`board-square ${isDark ? "dark" : "light"} ${piece ? "has-piece" : ""}`}
          >
            {piece && <div className="chess-piece">{piece}</div>}
            <div className="position-label">{position}</div>
          </div>
        );
      }
    }
    
    return (
      <div className="chess-board">
        {squares}
      </div>
    );
  };

  const renderDataChart = (data: ChessData) => {
    const position = data.isVerified ? data.decryptedValue : (decryptedPosition || 0);
    
    return (
      <div className="data-chart">
        <div className="chart-row">
          <div className="chart-label">Position</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${(position / 64) * 100}%` }}
            >
              <span className="bar-value">{position}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Verification</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${data.isVerified ? 100 : 0}%` }}
            >
              <span className="bar-value">{data.isVerified ? "Verified" : "Pending"}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Position Encryption</h4>
            <p>Chess piece position encrypted with FHE 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>On-chain Storage</h4>
            <p>Encrypted position stored on blockchain</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Move Validation</h4>
            <p>Homomorphic verification of move legality</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Position Update</h4>
            <p>New encrypted position stored</p>
          </div>
        </div>
      </div>
    );
  };

  const addHistory = (action: string) => {
    setHistory(prev => [action, ...prev.slice(0, 9)]);
  };

  const toggleFaq = (index: number) => {
    setFaqOpen(faqOpen === index ? null : index);
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Blind Chess ♟️</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">♟️</div>
            <h2>Connect Wallet to Play</h2>
            <p>Connect your wallet to start playing FHE-based Blind Chess</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet using button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will initialize automatically</p>
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
        <p>Initializing FHE Encryption...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted chess game...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Blind Chess ♟️</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Piece
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="tabs">
          <button 
            className={`tab-btn ${activeTab === "board" ? "active" : ""}`}
            onClick={() => setActiveTab("board")}
          >
            Chess Board
          </button>
          <button 
            className={`tab-btn ${activeTab === "data" ? "active" : ""}`}
            onClick={() => setActiveTab("data")}
          >
            Encrypted Data
          </button>
          <button 
            className={`tab-btn ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            History
          </button>
          <button 
            className={`tab-btn ${activeTab === "faq" ? "active" : ""}`}
            onClick={() => setActiveTab("faq")}
          >
            FAQ
          </button>
        </div>
        
        {activeTab === "board" && (
          <div className="board-section">
            <div className="panel metal-panel">
              <h2>Encrypted Chess Board</h2>
              {renderChessBoard()}
            </div>
            
            <div className="panel metal-panel">
              <h3>FHE Move Validation</h3>
              {renderFHEFlow()}
            </div>
          </div>
        )}
        
        {activeTab === "data" && (
          <div className="data-section">
            <div className="section-header">
              <h2>Encrypted Chess Pieces</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="data-list">
              {chessData.length === 0 ? (
                <div className="no-data">
                  <p>No encrypted pieces found</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Piece
                  </button>
                </div>
              ) : chessData.map((data, index) => (
                <div 
                  className={`data-item ${selectedPiece?.id === data.id ? "selected" : ""} ${data.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedPiece(data)}
                >
                  <div className="data-title">{data.name}</div>
                  <div className="data-meta">
                    <span>Position: {data.isVerified ? data.decryptedValue : "🔒 Encrypted"}</span>
                    <span>Created: {new Date(data.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="data-status">
                    Status: {data.isVerified ? "✅ Verified" : "🔓 Needs Verification"}
                  </div>
                  <div className="data-creator">Creator: {data.creator.substring(0, 6)}...{data.creator.substring(38)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "history" && (
          <div className="history-section">
            <h2>Operation History</h2>
            <div className="history-list">
              {history.length === 0 ? (
                <div className="no-history">
                  <p>No operations recorded yet</p>
                </div>
              ) : history.map((item, index) => (
                <div className="history-item" key={index}>
                  <div className="history-icon">📝</div>
                  <div className="history-content">{item}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-section">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-list">
              <div className="faq-item">
                <div className="faq-question" onClick={() => toggleFaq(0)}>
                  What is FHE-based Blind Chess?
                  <span className="faq-toggle">{faqOpen === 0 ? "−" : "+"}</span>
                </div>
                {faqOpen === 0 && (
                  <div className="faq-answer">
                    FHE-based Blind Chess is a chess variant where piece positions are encrypted using Fully Homomorphic Encryption (FHE). Players can verify move legality without revealing piece positions.
                  </div>
                )}
              </div>
              
              <div className="faq-item">
                <div className="faq-question" onClick={() => toggleFaq(1)}>
                  How does homomorphic verification work?
                  <span className="faq-toggle">{faqOpen === 1 ? "−" : "+"}</span>
                </div>
                {faqOpen === 1 && (
                  <div className="faq-answer">
                    Homomorphic encryption allows computations on encrypted data. When you move a piece, the system verifies the move's legality without decrypting the piece's position.
                  </div>
                )}
              </div>
              
              <div className="faq-item">
                <div className="faq-question" onClick={() => toggleFaq(2)}>
                  Why is my piece position encrypted?
                  <span className="faq-toggle">{faqOpen === 2 ? "−" : "+"}</span>
                </div>
                {faqOpen === 2 && (
                  <div className="faq-answer">
                    Encryption prevents your opponent from seeing your piece positions, creating true "blind" chess where strategy relies on deduction rather than direct observation.
                  </div>
                )}
              </div>
              
              <div className="faq-item">
                <div className="faq-question" onClick={() => toggleFaq(3)}>
                  How do I verify a piece's position?
                  <span className="faq-toggle">{faqOpen === 3 ? "−" : "+"}</span>
                </div>
                {faqOpen === 3 && (
                  <div className="faq-answer">
                    Select a piece and click "Verify Position". This will decrypt the position on-chain and update the board. Verification requires a blockchain transaction.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreatePiece 
          onSubmit={createPiece} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingPiece} 
          pieceData={newPieceData} 
          setPieceData={setNewPieceData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedPiece && (
        <PieceDetailModal 
          piece={selectedPiece} 
          onClose={() => { 
            setSelectedPiece(null); 
            setDecryptedPosition(null); 
          }} 
          decryptedPosition={decryptedPosition} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedPiece.id)}
          renderDataChart={renderDataChart}
        />
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
      
      <footer className="app-footer">
        <div className="footer-section">
          <h4>About FHE Blind Chess</h4>
          <p>Privacy-preserving chess using Fully Homomorphic Encryption</p>
        </div>
        <div className="footer-section">
          <h4>Technology</h4>
          <p>Powered by Zama FHE & Ethereum</p>
        </div>
      </footer>
    </div>
  );
};

const ModalCreatePiece: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  pieceData: any;
  setPieceData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, pieceData, setPieceData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPieceData({ ...pieceData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-piece-modal">
        <div className="modal-header">
          <h2>New Chess Piece</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Piece position will be encrypted with FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Piece Name *</label>
            <input 
              type="text" 
              name="name" 
              value={pieceData.name} 
              onChange={handleChange} 
              placeholder="Enter piece name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Board Position (0-63) *</label>
            <input 
              type="number" 
              name="position" 
              value={pieceData.position} 
              onChange={handleChange} 
              placeholder="Enter position..." 
              min="0"
              max="63"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <input 
              type="text" 
              name="description" 
              value={pieceData.description} 
              onChange={handleChange} 
              placeholder="Enter description..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !pieceData.name || !pieceData.position} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Piece"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PieceDetailModal: React.FC<{
  piece: ChessData;
  onClose: () => void;
  decryptedPosition: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderDataChart: (data: ChessData) => JSX.Element;
}> = ({ piece, onClose, decryptedPosition, isDecrypting, decryptData, renderDataChart }) => {
  const handleDecrypt = async () => {
    if (piece.isVerified) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="piece-detail-modal">
        <div className="modal-header">
          <h2>Chess Piece Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="piece-info">
            <div className="info-item">
              <span>Piece Name:</span>
              <strong>{piece.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{piece.creator.substring(0, 6)}...{piece.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(piece.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Position Data</h3>
            
            <div className="data-row">
              <div className="data-label">Board Position:</div>
              <div className="data-value">
                {piece.isVerified ? 
                  `${piece.decryptedValue} (Verified)` : 
                  decryptedPosition !== null ? 
                  `${decryptedPosition} (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${piece.isVerified ? 'verified' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || piece.isVerified}
              >
                {isDecrypting ? "Decrypting..." : piece.isVerified ? "✅ Verified" : "🔓 Decrypt Position"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Position Encryption</strong>
                <p>Piece position is encrypted on-chain. Decrypt to reveal actual board position.</p>
              </div>
            </div>
          </div>
          
          {(piece.isVerified || decryptedPosition !== null) && (
            <div className="analysis-section">
              <h3>Position Analysis</h3>
              {renderDataChart(piece)}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


