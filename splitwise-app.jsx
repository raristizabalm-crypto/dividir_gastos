import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, setPersistence, inMemoryPersistence } from 'firebase/auth';
import { getFirestore, doc, addDoc, setDoc, deleteDoc, collection, onSnapshot, query, getDocs, setLogLevel } from 'firebase/firestore';
import { Users, Plus, X, ArrowRight, BarChart2, Receipt, Home, DollarSign, Euro, Coins, Edit, Trash2, Loader, Send } from 'lucide-react';

// --- Configuración de Firebase ---
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let db, auth;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  setLogLevel('debug');
  
  // Usar persistencia en memoria para evitar problemas en iframes
  setPersistence(auth, inMemoryPersistence);
} catch (e) {
  console.error("Error al inicializar Firebase:", e);
}

// --- Constantes ---
const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'Dólar (USD)' },
  { code: 'COP', symbol: '$', name: 'Peso (COP)' },
  { code: 'EUR', symbol: '€', name: 'Euro (EUR)' },
  { code: 'VND', symbol: '₫', name: 'Dong (VND)' },
  { code: 'THB', symbol: '฿', name: 'Baht (THB)' },
];

const CURRENCY_MAP = new Map(CURRENCIES.map(c => [c.code, c]));

// --- Utilidad para Formato de Números ---
const formatNumber = (number, currencyCode = 'USD', locale = 'es-ES') => {
  if (typeof number !== 'number' || isNaN(number)) return '';
  
  // Intl.NumberFormat es robusto para manejo de miles y decimales según la moneda
  return new Intl.NumberFormat(locale, { 
    style: 'currency', 
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
};

// --- Componente Principal: App ---
export default function App() {
  const [page, setPage] = useState('loading'); // loading, tripSelector, tripSetup, setup, expenses, summary
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [trips, setTrips] = useState([]); // { id, name }
  const [travelers, setTravelers] = useState([]); // { id, name }
  const [transactions, setTransactions] = useState([]); // { id, description, amount, currency, date, paidBy, splitWith, type: 'expense'/'settlement' }

  // Componente de estado global para manejar el ID del viaje seleccionado.
  const [currentTripId, setCurrentTripId] = useState(() => localStorage.getItem('selectedTripId'));

  // Estados de Modales
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null); // Transacción que se está editando

  // 1. Efecto de Autenticación
  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        setIsAuthReady(true);
      } else {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
          } else {
            await signInAnonymously(auth);
          }
        } catch (error) {
          console.error("Error al iniciar sesión:", error);
          setPage('error');
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Efecto para Cargar Viajes (CORREGIDO el error de asignación de constante)
  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;

    const tripsPath = `artifacts/${appId}/users/${userId}/trips`;
    const q = query(collection(db, tripsPath));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTrips = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTrips(fetchedTrips);
      
      let newSelectedTripId = null;
      const storedTripId = localStorage.getItem('selectedTripId');

      // 1. Intentar usar el viaje guardado si existe y es válido
      if (storedTripId && fetchedTrips.some(t => t.id === storedTripId)) {
        newSelectedTripId = storedTripId;
      // 2. Si no hay viaje guardado o no es válido, intentar usar el primer viaje disponible
      } else if (fetchedTrips.length > 0) {
         newSelectedTripId = fetchedTrips[0].id;
         localStorage.setItem('selectedTripId', newSelectedTripId);
      } 
      
      // 3. Actualizar estado y página según el resultado de la selección
      if (newSelectedTripId && newSelectedTripId !== currentTripId) {
          setCurrentTripId(newSelectedTripId);
      } else if (!newSelectedTripId) {
        setCurrentTripId(null);
        if (fetchedTrips.length === 0) {
            // No hay viajes, ir a configuración de viaje
            setPage('tripSetup');
        } else {
            // Hay viajes, pero ninguno seleccionado (o el guardado no existe), ir al selector
            setPage('tripSelector');
        }
      } else if (page === 'loading') {
          // Si ya tenemos un viaje seleccionado, el siguiente efecto carga viajeros y transacciones.
      }
      
    }, (error) => {
      console.error("Error al cargar viajes: ", error);
      setPage('error');
    });

    // Se han ajustado las dependencias para evitar warnings y bucles.
    return () => unsubscribe();
  }, [isAuthReady, db, userId, currentTripId, setCurrentTripId, setPage]); 

  // 3. Efecto para Cargar Viajeros (depende del viaje seleccionado)
  useEffect(() => {
    if (!isAuthReady || !db || !userId || !currentTripId) {
      setTravelers([]); 
      return;
    }

    const travelersPath = `artifacts/${appId}/users/${userId}/trips/${currentTripId}/travelers`;
    const q = query(collection(db, travelersPath));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTravelers = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTravelers(fetchedTravelers);
      
      if (page === 'loading') { 
        if (fetchedTravelers.length === 0) {
          setPage('setup');
        } else {
          setPage('expenses');
        }
      }
    }, (error) => {
      console.error("Error al cargar viajeros: ", error);
      setPage('error');
    });

    return () => unsubscribe();
  }, [isAuthReady, db, userId, currentTripId, page]); 

  // 4. Efecto para Cargar Transacciones (Gastos y Liquidaciones)
  useEffect(() => {
    if (!isAuthReady || !db || !userId || !currentTripId) {
      setTransactions([]); 
      return;
    }

    // Nota: Mantenemos el nombre de la colección 'expenses' por compatibilidad con datos existentes, 
    // pero internamente manejamos como 'transactions'.
    const transactionsPath = `artifacts/${appId}/users/${userId}/trips/${currentTripId}/expenses`; 
    const q = query(collection(db, transactionsPath));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTransactions = snapshot.docs.map(doc => ({
        id: doc.id,
        // Si el tipo no está definido (datos viejos), asumimos que es un 'expense'
        type: doc.data().type || 'expense', 
        ...doc.data()
      }));
      setTransactions(fetchedTransactions);
    }, (error) => {
      console.error("Error al cargar transacciones: ", error);
    });

    return () => unsubscribe();
  }, [isAuthReady, db, userId, currentTripId]);

  // --- Funciones de Firestore ---

  const handleCreateTrip = useCallback(async (tripName) => {
    if (!db || !userId) return;
    try {
      const tripsPath = `artifacts/${appId}/users/${userId}/trips`;
      const newTripRef = await addDoc(collection(db, tripsPath), { name: tripName });
      setCurrentTripId(newTripRef.id);
      localStorage.setItem('selectedTripId', newTripRef.id); 
      setPage('setup'); 
    } catch (error) {
      console.error("Error al crear viaje:", error);
    }
  }, [db, userId, appId]);

  const handleSelectTrip = useCallback((tripId) => {
    setTransactions([]); 
    setTravelers([]); 
    setCurrentTripId(tripId);
    localStorage.setItem('selectedTripId', tripId);
    setPage('loading'); 
  }, []);

  const handleGoToTrips = useCallback(() => {
    setCurrentTripId(null);
    localStorage.removeItem('selectedTripId');
    setPage('tripSelector');
  }, []);

  const handleSaveTravelers = useCallback(async (names) => {
    if (!db || !userId || !currentTripId) return;
    try {
      const travelersPath = `artifacts/${appId}/users/${userId}/trips/${currentTripId}/travelers`;
      
      const validAndUniqueNames = Array.from(new Set(names.map(name => name.trim()).filter(name => name)));

      if (validAndUniqueNames.length < 2) {
          console.error('Se requieren al menos dos nombres de viajeros únicos.'); 
          return;
      }
      
      const existingTravelers = await getDocs(collection(db, travelersPath));
      const deletePromises = existingTravelers.docs.map(d => deleteDoc(doc(db, travelersPath, d.id)));
      await Promise.all(deletePromises);
      
      const addPromises = validAndUniqueNames.map(name => 
        addDoc(collection(db, travelersPath), { name })
      );
      await Promise.all(addPromises);

      setPage('expenses');

    } catch (error) {
      console.error("Error al guardar viajeros:", error);
    }
  }, [db, userId, currentTripId, appId]);

  // Función para añadir o actualizar una transacción (Gasto o Liquidación)
  const handleSaveTransaction = useCallback(async (transaction, id = null) => {
    if (!db || !userId || !currentTripId) return;
    try {
      const transactionsPath = `artifacts/${appId}/users/${userId}/trips/${currentTripId}/expenses`;
      
      if (id) {
        // Actualizar transacción
        await setDoc(doc(db, transactionsPath, id), transaction, { merge: true });
        console.log("Transacción actualizada con ID:", id);
      } else {
        // Añadir nueva transacción
        await addDoc(collection(db, transactionsPath), transaction);
        console.log("Nueva transacción añadida.");
      }
      setIsExpenseModalOpen(false); 
      setIsSettlementModalOpen(false);
      setEditingTransaction(null);
    } catch (error) {
      console.error("Error al guardar/actualizar transacción:", error);
    }
  }, [db, userId, currentTripId, appId]);

  // Función para eliminar una transacción
  const handleDeleteTransaction = useCallback(async (id) => {
    if (!db || !userId || !currentTripId) return;
    
    try {
      const transactionsPath = `artifacts/${appId}/users/${userId}/trips/${currentTripId}/expenses`;
      const docRef = doc(db, transactionsPath, id);
      await deleteDoc(docRef); 
      console.log(`Transacción ${id} eliminada correctamente.`);
    } catch (error) {
      console.error("Error al eliminar transacción:", error);
    }
  }, [db, userId, currentTripId, appId]);

  // Funciones para los Modales
  const openExpenseModal = () => {
    setEditingTransaction(null);
    setIsExpenseModalOpen(true);
  };
  
  const openSettlementModal = () => {
    setEditingTransaction(null);
    setIsSettlementModalOpen(true);
  };

  const openEditModal = (transaction) => {
    setEditingTransaction(transaction);
    if (transaction.type === 'expense') {
      setIsExpenseModalOpen(true);
    } else if (transaction.type === 'settlement') {
      setIsSettlementModalOpen(true);
    }
  };

  const closeModals = () => {
    setIsExpenseModalOpen(false);
    setIsSettlementModalOpen(false);
    setEditingTransaction(null);
  };


  // --- Renderizado ---
  const selectedTrip = useMemo(() => trips.find(t => t.id === currentTripId), [trips, currentTripId]);

  const renderPage = () => {
    if (page === 'loading' || !isAuthReady) {
        return <LoadingSpinner />;
    }
    
    switch (page) {
      case 'tripSetup':
        return <TripSetup onCreateTrip={handleCreateTrip} />;
      case 'tripSelector':
        return <TripSelector trips={trips} onSelectTrip={handleSelectTrip} onCreateTrip={() => setPage('tripSetup')} />;
      case 'setup':
        return <TravelerSetup travelers={travelers} onSaveTravelers={handleSaveTravelers} />;
      case 'expenses':
        return (
          <ExpensePage 
            travelers={travelers} 
            transactions={transactions} 
            onDeleteTransaction={handleDeleteTransaction} 
            openExpenseModal={openExpenseModal}
            openSettlementModal={openSettlementModal} 
            openEditModal={openEditModal}
          />
        );
      case 'summary':
        return <SummaryPage travelers={travelers} transactions={transactions} />;
      case 'error':
        return <div className="text-center text-red-500">Error al cargar la aplicación. Revisa la consola.</div>;
      default:
        return null;
    }
  };

  return (
    <div className="flex justify-center items-start min-h-screen bg-gray-100 p-4 sm:p-8 font-sans">
      <script src="https://cdn.tailwindcss.com"></script>
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        <Header userId={userId} tripName={selectedTrip?.name} />
        
        {currentTripId && (page !== 'tripSelector' && page !== 'tripSetup') && (
          <NavBar currentPage={page} setPage={setPage} onGoToTrips={handleGoToTrips} />
        )}
        
        <main className="p-4 sm:p-8">
          {renderPage()}
        </main>

        {/* Modal para Gastos */}
        {isExpenseModalOpen && (
          <ExpenseModal 
            isOpen={isExpenseModalOpen}
            onClose={closeModals}
            travelers={travelers}
            transaction={editingTransaction} // Ahora es transaction
            onSave={handleSaveTransaction}
          />
        )}
        
        {/* Modal para Liquidaciones/Pagos de Deuda */}
        {isSettlementModalOpen && (
          <SettlementModal 
            isOpen={isSettlementModalOpen}
            onClose={closeModals}
            travelers={travelers}
            transaction={editingTransaction} // Ahora es transaction
            onSave={handleSaveTransaction}
          />
        )}

      </div>
    </div>
  );
}

// --- Componente: Cabecera ---
function Header({ userId, tripName }) {
  return (
    <header className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-6 shadow-md">
      <h1 className="text-3xl font-bold text-center">Calculadora de Gastos de Viaje</h1>
      {tripName && (
        <h2 className="text-xl font-semibold text-center text-blue-100 mt-2">{tripName}</h2>
      )}
      {userId && (
        <p className="text-center text-xs text-blue-200 mt-2">
          ID de Usuario: {userId}
        </p>
      )}
    </header>
  );
}

// --- Componente: Barra de Navegación ---
function NavBar({ currentPage, setPage, onGoToTrips }) {
  const navItems = [
    { id: 'tripSelector', label: 'Mis Viajes', icon: Home },
    { id: 'expenses', label: 'Transacciones', icon: Receipt }, // Cambiado a Transacciones
    { id: 'summary', label: 'Resumen', icon: BarChart2 },
    { id: 'setup', label: 'Viajeros', icon: Users },
  ];

  return (
    <nav className="flex justify-center bg-gray-50 border-b border-gray-200">
      {navItems.map(item => {
        const isActive = currentPage === item.id;
        return (
          <button
            key={item.id}
            onClick={() => item.id === 'tripSelector' ? onGoToTrips() : setPage(item.id)}
            className={`flex items-center gap-2 px-4 py-3 sm:px-6 font-medium text-sm sm:text-base transition-all duration-200
              ${isActive
                ? 'border-b-4 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:bg-gray-100 hover:text-blue-500'
              }`}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

// --- Componente: Pantalla de Configuración de Viajeros (sin cambios) ---
function TravelerSetup({ onSaveTravelers, travelers }) {
  const [numTravelers, setNumTravelers] = useState(travelers.length || 2);
  const [names, setNames] = useState(() => 
    travelers.length > 0 
      ? travelers.map(t => t.name) 
      : Array(2).fill('')
  );

  useEffect(() => {
    if (names.length !== numTravelers) {
      setNames(oldNames => {
        const newNames = Array(numTravelers).fill('');
        oldNames.slice(0, numTravelers).forEach((name, i) => newNames[i] = name);
        return newNames;
      });
    }
  }, [numTravelers]);

  const handleNumChange = (e) => {
    const num = Math.max(2, parseInt(e.target.value) || 2);
    setNumTravelers(num);
  };

  const handleNameChange = (index, value) => {
    const newNames = [...names];
    newNames[index] = value;
    setNames(newNames);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSaveTravelers(names);
  };

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-semibold text-gray-800 mb-6">1. Configurar Viajeros</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="numTravelers" className="block text-sm font-medium text-gray-700 mb-1">
            ¿Cuántos viajeros son?
          </label>
          <input
            type="number"
            id="numTravelers"
            min="2"
            value={numTravelers}
            onChange={handleNumChange}
            className="w-full max-w-xs p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Nombres de los viajeros:
          </label>
          {names.slice(0, numTravelers).map((name, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="text-gray-500 font-medium w-6">{index + 1}.</span>
              <input
                type="text"
                placeholder={`Nombre del Viajero ${index + 1}`}
                value={name}
                onChange={(e) => handleNameChange(index, e.target.value)}
                className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          ))}
        </div>

        <div className="pt-4">
          <button
            type="submit"
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-blue-700 transition duration-300 transform hover:-translate-y-0.5"
          >
            Guardar Viajeros
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Componente: Pantalla Principal de Transacciones ---
function ExpensePage({ travelers, transactions, onDeleteTransaction, openExpenseModal, openSettlementModal, openEditModal }) {
  // Mapa de viajeros para búsqueda rápida de nombres
  const travelerMap = useMemo(() => {
    return new Map(travelers.map(t => [t.id, t.name]));
  }, [travelers]);

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="flex flex-col sm:flex-row justify-end gap-3">
        <button
          onClick={openSettlementModal}
          className="flex items-center justify-center gap-2 bg-yellow-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-yellow-700 transition duration-300"
        >
          <Send className="w-5 h-5" /> Registrar Pago de Deuda
        </button>
        <button
          onClick={openExpenseModal}
          className="flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-green-700 transition duration-300"
        >
          <Plus className="w-5 h-5" /> Añadir Gasto
        </button>
      </div>
      <ExpenseList // Renombrado internamente para manejar ambas
        transactions={transactions} 
        travelerMap={travelerMap} 
        onDeleteTransaction={onDeleteTransaction} 
        onEditTransaction={openEditModal} 
      />
    </div>
  );
}

// --- Componente: Modal para Añadir/Editar Gasto (Tipo 'expense') ---
function ExpenseModal({ isOpen, onClose, travelers, transaction, onSave }) {
  const [description, setDescription] = useState(transaction?.description || '');
  const [amount, setAmount] = useState(transaction?.amount || '');
  const [currency, setCurrency] = useState(transaction?.currency || 'USD'); 
  const [date, setDate] = useState(transaction?.date || new Date().toISOString().split('T')[0]);
  const [paidBy, setPaidBy] = useState(transaction?.paidBy || travelers[0]?.id || '');
  const [splitWith, setSplitWith] = useState({});

  useEffect(() => {
    const initialSplit = travelers.reduce((acc, t) => {
      const isParticipant = transaction && transaction.type === 'expense' ? transaction.splitWith.includes(t.id) : true;
      acc[t.id] = isParticipant; 
      return acc;
    }, {});
    setSplitWith(initialSplit);
    setPaidBy(transaction?.paidBy || travelers[0]?.id || ''); 
  }, [travelers, transaction]);


  const handleSplitChange = (travelerId) => {
    setSplitWith(prev => ({
      ...prev,
      [travelerId]: !prev[travelerId]
    }));
  };
  
  const handleSubmit = (e) => {
    e.preventDefault();
    const finalAmount = parseFloat(amount);
    const participants = Object.keys(splitWith).filter(id => splitWith[id]);

    if (!description || !finalAmount || finalAmount <= 0 || !date || !paidBy || participants.length === 0) {
      console.error("Por favor, completa todos los campos y asegúrate de que el monto sea positivo y al menos un viajero participe.");
      return;
    }

    const transactionData = {
      type: 'expense', // Definir el tipo
      description,
      amount: finalAmount,
      currency,
      date,
      paidBy,
      splitWith: participants,
    };

    onSave(transactionData, transaction?.id); 
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden transform transition-all">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-green-50">
          <h3 className="text-xl font-semibold text-gray-800 flex items-center gap-2"><Receipt className="w-6 h-6 text-green-600" /> {transaction ? 'Editar Gasto' : 'Añadir Nuevo Gasto'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <input type="text" id="description" value={description} onChange={e => setDescription(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-lg shadow-sm" placeholder="Cena, Taxis, Hotel..." />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
              <input type="number" id="amount" value={amount} onChange={e => setAmount(e.target.value)} required min="0.01" step="0.01" className="w-full p-3 border border-gray-300 rounded-lg shadow-sm" placeholder="0.00" />
            </div>
            <div>
              <label htmlFor="currency" className="block text-sm font-medium text-gray-700 mb-1">Moneda</label>
              <select id="currency" value={currency} onChange={e => setCurrency(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-lg shadow-sm bg-white">
                {CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div>
            <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
            <input type="date" id="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-lg shadow-sm" />
          </div>

          <div>
            <label htmlFor="paidBy" className="block text-sm font-medium text-gray-700 mb-1">Pagado por:</label>
            <select id="paidBy" value={paidBy} onChange={e => setPaidBy(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-lg shadow-sm bg-white">
              {travelers.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dividir entre:</label>
            <div className="space-y-2">
              {travelers.map(t => (
                <label key={t.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={splitWith[t.id] || false}
                    onChange={() => handleSplitChange(t.id)}
                    className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-gray-700">{t.name}</span>
                </label>
              ))}
            </div>
          </div>
          
          <div className="pt-4">
            <button type="submit" className={`w-full flex items-center justify-center gap-2 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition duration-300 ${transaction ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'}`}>
              {transaction ? <Edit className="w-5 h-5" /> : <Plus className="w-5 h-5" />} {transaction ? 'Guardar Cambios' : 'Añadir Gasto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Componente: Modal para Registrar Pago de Deuda (Tipo 'settlement') ---
function SettlementModal({ isOpen, onClose, travelers, transaction, onSave }) {
    const [amount, setAmount] = useState(transaction?.amount || '');
    const [currency, setCurrency] = useState(transaction?.currency || 'USD'); 
    const [date, setDate] = useState(transaction?.date || new Date().toISOString().split('T')[0]);
    const [payerId, setPayerId] = useState(transaction?.payerId || travelers[0]?.id || '');
    const [receiverId, setReceiverId] = useState(transaction?.receiverId || travelers.find(t => t.id !== payerId)?.id || '');

    // Ajustar el receptor si el pagador cambia y son iguales
    useEffect(() => {
        if (payerId === receiverId && travelers.length > 1) {
            const defaultReceiver = travelers.find(t => t.id !== payerId)?.id;
            setReceiverId(defaultReceiver || '');
        }
    }, [payerId, travelers, receiverId]);
    
    // Inicializar estados para edición
    useEffect(() => {
        if (transaction && transaction.type === 'settlement') {
            setAmount(transaction.amount);
            setCurrency(transaction.currency);
            setDate(transaction.date);
            setPayerId(transaction.payerId);
            setReceiverId(transaction.receiverId);
        }
    }, [transaction]);


    const handleSubmit = (e) => {
        e.preventDefault();
        const finalAmount = parseFloat(amount);

        if (!finalAmount || finalAmount <= 0 || !date || !payerId || !receiverId || payerId === receiverId) {
            console.error("Por favor, completa todos los campos y asegúrate de que el monto sea positivo y que el pagador y el receptor sean diferentes.");
            return;
        }

        const transactionData = {
            type: 'settlement', // Definir el tipo
            description: `${travelers.find(t => t.id === payerId)?.name} pagó a ${travelers.find(t => t.id === receiverId)?.name}`,
            amount: finalAmount,
            currency,
            date,
            payerId, // Nuevo campo
            receiverId, // Nuevo campo
        };

        onSave(transactionData, transaction?.id); 
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden transform transition-all">
                <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-yellow-50">
                    <h3 className="text-xl font-semibold text-gray-800 flex items-center gap-2"><DollarSign className="w-6 h-6 text-yellow-600" /> {transaction ? 'Editar Pago de Deuda' : 'Registrar Pago de Deuda'}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">Monto Pagado</label>
                            <input type="number" id="amount" value={amount} onChange={e => setAmount(e.target.value)} required min="0.01" step="0.01" className="w-full p-3 border border-gray-300 rounded-lg shadow-sm" placeholder="0.00" />
                        </div>
                        <div>
                            <label htmlFor="currency" className="block text-sm font-medium text-gray-700 mb-1">Moneda</label>
                            <select id="currency" value={currency} onChange={e => setCurrency(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-lg shadow-sm bg-white">
                                {CURRENCIES.map(c => (
                                    <option key={c.code} value={c.code}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    
                    <div>
                        <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                        <input type="date" id="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-lg shadow-sm" />
                    </div>

                    <div>
                        <label htmlFor="payerId" className="block text-sm font-medium text-gray-700 mb-1">Pagador (quien debe)</label>
                        <select id="payerId" value={payerId} onChange={e => setPayerId(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-lg shadow-sm bg-white">
                            {travelers.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="receiverId" className="block text-sm font-medium text-gray-700 mb-1">Receptor (a quien se paga)</label>
                        <select id="receiverId" value={receiverId} onChange={e => setReceiverId(e.target.value)} required className="w-full p-3 border border-gray-300 rounded-lg shadow-sm bg-white">
                            {travelers.filter(t => t.id !== payerId).map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                         {payerId === receiverId && <p className="text-red-500 text-sm mt-1">El pagador y el receptor deben ser diferentes.</p>}
                    </div>
                    
                    <div className="pt-4">
                        <button type="submit" className={`w-full flex items-center justify-center gap-2 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition duration-300 ${transaction ? 'bg-blue-600 hover:bg-blue-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}>
                            <Send className="w-5 h-5" /> {transaction ? 'Guardar Liquidación' : 'Registrar Liquidación'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// --- Componente: Lista de Transacciones (Gastos y Liquidaciones) ---
function ExpenseList({ transactions, travelerMap, onDeleteTransaction, onEditTransaction }) {
  // Ordenar transacciones por fecha
  const sortedTransactions = useMemo(() => {
    return [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [transactions]);
  
  const handleDeleteClick = (id) => {
      // Uso de modal de confirmación en lugar de window.confirm()
      const confirmDelete = window.confirm || ((msg) => { console.log(msg); return true; }); // Fallback simple para el entorno
      
      if (confirmDelete("¿Estás seguro de que quieres eliminar esta transacción? Esta acción no se puede deshacer.")) {
          onDeleteTransaction(id);
      }
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow-lg border border-gray-200">
      <h3 className="text-xl font-semibold text-gray-800 mb-4">Historial de Transacciones</h3>
      {sortedTransactions.length === 0 ? (
        <p className="text-gray-500 text-center py-8">Aún no hay transacciones registradas.</p>
      ) : (
        <ul className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto pr-2">
          {sortedTransactions.map(t => {
            const isExpense = t.type === 'expense';
            
            return (
              <li key={t.id} className="flex items-start justify-between gap-4 py-4 animate-fade-in-sm">
                <div className="flex-1">
                  {/* Título y descripción */}
                  <p className={`font-semibold ${isExpense ? 'text-gray-800' : 'text-yellow-700'}`}>
                    {isExpense ? t.description : `Pago de Deuda: ${travelerMap.get(t.payerId)} a ${travelerMap.get(t.receiverId)}`}
                  </p>
                  
                  {/* Detalles */}
                  <div className="text-sm text-gray-600 mt-1">
                    {isExpense ? (
                      <p>Pagado por <span className="font-medium text-blue-600">{travelerMap.get(t.paidBy) || '...'}</span></p>
                    ) : (
                      <p>Liquidación registrada</p>
                    )}
                    <p className="text-xs text-gray-500">
                        {new Date(t.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                        {isExpense && ` | Dividido entre: ${t.splitWith.map(id => travelerMap.get(id)).join(', ')}`}
                    </p>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-lg font-bold whitespace-nowrap ${isExpense ? 'text-green-600' : 'text-yellow-600'}`}>
                    {/* Aplicar formato de miles y moneda */}
                    {formatNumber(t.amount, t.currency)}
                  </span>
                  <div className="flex gap-2">
                      <button
                        onClick={() => onEditTransaction(t)}
                        className="text-blue-500 hover:text-blue-700 transition"
                        aria-label="Editar transacción"
                        title="Editar transacción"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(t.id)}
                        className="text-red-500 hover:text-red-700 transition"
                        aria-label="Eliminar transacción"
                        title="Eliminar transacción"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- Componente: Pantalla de Resumen (LÓGICA ACTUALIZADA) ---
function SummaryPage({ travelers, transactions }) {
  
  const { totalsByTraveler, settlements, totalExpensesByCurrency } = useMemo(() => {
    // 1. Inicializar totales por viajero para cada moneda
    const travelerTotals = new Map(travelers.map(t => [t.id, {
      name: t.name,
      ...CURRENCIES.reduce((acc, c) => ({
        ...acc,
        [c.code]: { paid: 0, share: 0, balance: 0 } // balance es el balance NETO
      }), {})
    }]));
    
    let totalExpensesByCurrency = CURRENCIES.reduce((acc, c) => ({ ...acc, [c.code]: 0 }), {});

    // --- PRIMER PASO: Calcular 'paid' y 'share' basados SOLO en GASTOS ('expense') ---
    const expenses = transactions.filter(t => t.type === 'expense');

    for (const expense of expenses) {
      const { amount, currency, paidBy, splitWith } = expense;
      if (!totalExpensesByCurrency.hasOwnProperty(currency)) continue; 

      totalExpensesByCurrency[currency] += amount;
      const sharePerPerson = amount / splitWith.length;

      // Sumar al que pagó
      if (travelerTotals.has(paidBy)) {
        travelerTotals.get(paidBy)[currency].paid += amount;
      }

      // Sumar la parte (deuda) a cada participante
      for (const participantId of splitWith) {
        if (travelerTotals.has(participantId)) {
          travelerTotals.get(participantId)[currency].share += sharePerPerson;
        }
      }
    }

    // 2. Calcular BALANCE INICIAL (solo con gastos) y aplicar LIQUIDACIONES
    const settlementsTransactions = transactions.filter(t => t.type === 'settlement');

    for (const data of travelerTotals.values()) {
      for (const currency of CURRENCIES.map(c => c.code)) {
        // Balance inicial = Pagado - Parte
        data[currency].balance = data[currency].paid - data[currency].share;
      }
    }

    // 3. Aplicar pagos manuales ('settlement') al balance
    for (const settlement of settlementsTransactions) {
        const { amount, currency, payerId, receiverId } = settlement;
        
        if (travelerTotals.has(payerId) && travelerTotals.has(receiverId)) {
            // El pagador reduce su deuda (balance negativo) o su crédito (balance positivo)
            travelerTotals.get(payerId)[currency].balance += amount; 
            
            // El receptor reduce su crédito (balance positivo) o aumenta su deuda (balance negativo)
            travelerTotals.get(receiverId)[currency].balance -= amount;
        }
    }
    
    // 4. Algoritmo para saldar cuentas (por moneda) basado en el balance NETO
    const finalSettlements = {};

    for (const currency of CURRENCIES.map(c => c.code)) {
      const owers = []; // Deben dinero (saldo negativo)
      const owees = []; // Les deben dinero (saldo positivo)

      for (const [id, data] of travelerTotals.entries()) {
        // Redondear el balance a dos decimales
        const finalBalance = parseFloat(data[currency].balance.toFixed(2));
        data[currency].balance = finalBalance; // Sobreescribir con el balance ajustado y redondeado
        
        if (finalBalance < -0.01) { 
          owers.push({ id, amount: -finalBalance }); // Guardar como positivo
        } else if (finalBalance > 0.01) {
          owees.push({ id, amount: finalBalance });
        }
      }
      
      const transactions = [];
      owers.sort((a, b) => b.amount - a.amount);
      owees.sort((a, b) => b.amount - a.amount);

      let owerIndex = 0;
      let oweeIndex = 0;

      while (owerIndex < owers.length && oweeIndex < owees.length) {
        const ower = owers[owerIndex];
        const owee = owees[oweeIndex];
        
        const amountToTransfer = Math.min(
          parseFloat(ower.amount.toFixed(2)), 
          parseFloat(owee.amount.toFixed(2))
        );

        transactions.push({
          from: ower.id,
          to: owee.id,
          amount: amountToTransfer,
        });

        ower.amount = parseFloat((ower.amount - amountToTransfer).toFixed(2));
        owee.amount = parseFloat((owee.amount - amountToTransfer).toFixed(2));

        if (ower.amount < 0.01) owerIndex++;
        if (owee.amount < 0.01) oweeIndex++;
      }
      
      finalSettlements[currency] = { transactions };
    }

    return { 
      totalsByTraveler: Array.from(travelerTotals.values()), 
      settlements: finalSettlements, 
      totalExpensesByCurrency 
    };

  }, [travelers, transactions]); // Depende de todas las transacciones
  
  const travelerMap = useMemo(() => {
    return new Map(travelers.map(t => [t.id, t.name]));
  }, [travelers]);

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* --- Totales Generales por Moneda (Solo Gastos) --- */}
      <div>
        <h3 className="text-xl font-semibold text-gray-800 mb-4">Gasto Total del Viaje (Excluyendo Liquidaciones)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CURRENCIES.map(c => (
            <div key={c.code} className="p-4 bg-blue-50 rounded-xl border border-blue-200 text-center">
              <h4 className="text-md font-medium text-blue-800">{c.name}</h4>
              <p className="text-2xl font-bold text-blue-600 mt-1">
                {formatNumber(totalExpensesByCurrency[c.code], c.code)}
              </p>
            </div>
          ))}
        </div>
      </div>
      
      {/* --- Resumen por Moneda --- */}
      <div className="space-y-8">
        {CURRENCIES.map(currency => {
          const { code, symbol } = currency;
          const currencyTotals = totalsByTraveler.map(t => ({
            name: t.name,
            ...t[code]
          }));
          
          const totalInCurrency = totalExpensesByCurrency[code];

          // Solo renderizar si hay transacciones o totales en esta moneda
          if (totalInCurrency > 0.01 || transactions.some(t => t.currency === code && t.type === 'settlement')) {
            return (
              <div key={code} className="p-6 bg-white rounded-xl shadow-lg border border-gray-200">
                <h4 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Coins className="w-6 h-6 text-yellow-600" /> Resumen en {currency.name} ({code})
                </h4>

                {/* Tabla de Balances */}
                <h5 className="text-lg font-semibold text-gray-700 mt-6 mb-3">Saldos Netos (Después de Pagos de Deuda)</h5>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 rounded-lg overflow-hidden">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Viajero</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Pagado</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Parte</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Balance NETO</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {currencyTotals.map(t => (
                        <tr key={t.name} className={`${t.balance < -0.01 ? 'bg-red-50' : t.balance > 0.01 ? 'bg-green-50' : ''}`}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{t.name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
                            {formatNumber(t.paid, code)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
                            {formatNumber(t.share, code)}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold text-right ${t.balance < -0.01 ? 'text-red-600' : t.balance > 0.01 ? 'text-green-600' : 'text-gray-600'}`}>
                            {formatNumber(t.balance, code)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Sección de Liquidación Final */}
                <h5 className="text-lg font-semibold text-gray-700 mt-8 mb-3">Liquidación Final Recomendada ({code})</h5>
                {settlements[code].transactions.length > 0 ? (
                  <ul className="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    {settlements[code].transactions.map((t, index) => (
                      <li key={index} className="flex flex-wrap items-center text-gray-800">
                        <span className="font-medium">{travelerMap.get(t.from)}</span> debe
                        <span className="font-bold mx-2 text-red-600">
                          {formatNumber(t.amount, code)}
                        </span>
                        a <span className="font-medium ml-2">{travelerMap.get(t.to)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-green-600 bg-green-50 p-3 rounded-lg border border-green-200">
                    ¡Cuentas saldadas en {code}! No se necesita hacer más pagos.
                  </p>
                )}
              </div>
            );
          }
          return null; 
        })}
      </div>
    </div>
  );
}


// --- Componentes Nuevos (TripSelector, TripSetup, LoadingSpinner - sin cambios) ---

function TripSetup({ onCreateTrip }) {
  const [tripName, setTripName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (tripName.trim()) {
      onCreateTrip(tripName.trim());
    }
  };

  return (
    <div className="animate-fade-in text-center p-8">
      <h2 className="text-2xl font-semibold text-gray-800 mb-6">Crear tu Primer Viaje</h2>
      <p className="text-gray-600 mb-8">¡Bienvenido! Vamos a empezar dándole un nombre a tu viaje.</p>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 max-w-lg mx-auto">
        <input
          type="text"
          placeholder="Ej: Viaje a la Costa, Eurotrip 2025"
          value={tripName}
          onChange={(e) => setTripName(e.target.value)}
          required
          className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-blue-700 transition duration-300 transform hover:-translate-y-0.5"
        >
          Crear Viaje <ArrowRight className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}

function TripSelector({ trips, onSelectTrip, onCreateTrip }) {
  return (
    <div className="animate-fade-in p-4 sm:p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Mis Viajes</h2>
        <button
          onClick={onCreateTrip}
          className="flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-green-700 transition duration-300"
        >
          <Plus className="w-5 h-5" /> Nuevo Viaje
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {trips.map(trip => (
          <button
            key={trip.id}
            onClick={() => onSelectTrip(trip.id)}
            className="p-6 bg-white rounded-xl shadow-lg border border-gray-200 text-left hover:shadow-xl hover:border-blue-500 transition-all duration-300 transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-bold text-gray-800">{trip.name}</h3>
            <p className="text-sm text-gray-500 mt-2">Seleccionar este viaje</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center items-center py-20">
      <Loader className="w-16 h-16 animate-spin text-blue-600" />
    </div>
  );
}