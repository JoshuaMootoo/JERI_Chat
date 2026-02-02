
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, TranslatedMessage, ChatRoom, Message } from './types';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './constants';
import { translateText } from './services/geminiService';
import { chatSync } from './services/chatSync';
import { supabase } from './services/supabase';
import LanguageSelector from './components/LanguageSelector';
import ChatBubble from './components/ChatBubble';

interface AppUser extends User {
  isGuest?: boolean;
}

const App: React.FC = () => {
  // --- Auth & User State ---
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isLoginView, setIsLoginView] = useState(true);
  const [isGuestSetup, setIsGuestSetup] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [onboardingLang, setOnboardingLang] = useState(DEFAULT_LANGUAGE);
  const [isLoading, setIsLoading] = useState(true);

  // --- Chat State ---
  const [currentRoom, setCurrentRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<TranslatedMessage[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'rooms' | 'settings'>('rooms');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<AppUser | null>(null);
  
  useEffect(() => { userRef.current = currentUser; }, [currentUser]);

  // Auth & Session Initialization
  useEffect(() => {
    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const metadata = session.user.user_metadata;
          setCurrentUser({
            username: metadata.username || session.user.email?.split('@')[0],
            email: session.user.email!,
            preferredLanguage: metadata.preferredLanguage || DEFAULT_LANGUAGE,
            friends: metadata.friends || [],
            friendRequests: metadata.friendRequests || [],
            isGuest: false
          });
        } else {
          const savedGuest = localStorage.getItem('jeri_guest_user');
          if (savedGuest) {
            setCurrentUser(JSON.parse(savedGuest));
          }
        }
      } catch (e) {
        console.error("Session init error", e);
      } finally {
        setIsLoading(false);
      }
    };
    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const metadata = session.user.user_metadata;
        setCurrentUser({
          username: metadata.username || session.user.email?.split('@')[0],
          email: session.user.email!,
          preferredLanguage: metadata.preferredLanguage || DEFAULT_LANGUAGE,
          friends: metadata.friends || [],
          friendRequests: metadata.friendRequests || [],
          isGuest: false
        });
      } else if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Translation Side-Effect Handler
  useEffect(() => {
    const untranslated = messages.find(m => m.isTranslating && !m.translatedText);
    if (untranslated && currentUser) {
      const doTranslation = async () => {
        const targetLangName = SUPPORTED_LANGUAGES.find(l => l.code === currentUser.preferredLanguage)?.name || currentUser.preferredLanguage;
        const sourceLangName = SUPPORTED_LANGUAGES.find(l => l.code === untranslated.senderLanguage)?.name || untranslated.senderLanguage;
        
        try {
          const translated = await translateText(untranslated.text, targetLangName, sourceLangName);
          setMessages(prev => prev.map(m => m.id === untranslated.id ? { ...m, translatedText: translated, isTranslating: false } : m));
        } catch (err) {
          console.error("Translation error", err);
          setMessages(prev => prev.map(m => m.id === untranslated.id ? { ...m, isTranslating: false, translatedText: untranslated.text } : m));
        }
      };
      doTranslation();
    }
  }, [messages, currentUser]);

  const processMessage = useCallback((msg: Message) => {
    const user = userRef.current;
    if (!user) return;

    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;

      const tempMatchIdx = prev.findIndex(m => 
        m.id.toString().startsWith('temp-') && 
        m.senderEmail === msg.senderEmail && 
        m.text === msg.text
      );

      const newMessage: TranslatedMessage = {
        ...msg,
        isTranslating: msg.senderLanguage !== user.preferredLanguage && msg.senderEmail !== user.email
      };

      const newList = [...prev];
      if (tempMatchIdx !== -1) {
        newList[tempMatchIdx] = newMessage;
      } else {
        newList.push(newMessage);
      }

      return newList.sort((a, b) => a.timestamp - b.timestamp);
    });
  }, []);

  useEffect(() => {
    if (currentRoom && currentUser) {
      let isMounted = true;
      const initRoom = async () => {
        setIsHistoryLoading(true);
        setMessages([]); 
        setError(null);
        
        chatSync.connect(currentRoom.id);
        
        try {
          const history = await chatSync.fetchHistory(currentRoom.id);
          if (isMounted) {
            setMessages(prev => {
              const unique = new Map<string, TranslatedMessage>();
              [...history, ...prev].forEach(m => unique.set(m.id, m as TranslatedMessage));
              return Array.from(unique.values()).sort((a, b) => a.timestamp - b.timestamp);
            });
          }
        } catch (err: any) {
          console.error("Room init failed:", err);
          setError(`Sync Error: ${err.message || "Failed to load messages."}`);
        } finally {
          if (isMounted) setIsHistoryLoading(false);
        }
      };

      initRoom();
      const unsub = chatSync.onMessage(processMessage);
      
      return () => {
        isMounted = false;
        unsub();
        chatSync.disconnect();
      };
    }
  }, [currentRoom?.id, currentUser?.email, processMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !currentUser || !currentRoom) return;

    const textToSubmit = inputText;
    const roomToSubmit = currentRoom.id;
    setInputText('');
    setError(null);

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: TranslatedMessage = {
      id: tempId,
      sender: currentUser.username,
      senderEmail: currentUser.email,
      senderLanguage: currentUser.preferredLanguage,
      text: textToSubmit,
      timestamp: Date.now(),
      isTranslating: false
    };

    setMessages(prev => [...prev, optimisticMessage]);

    try {
      await chatSync.sendMessage(roomToSubmit, {
        sender: currentUser.username,
        senderEmail: currentUser.email,
        senderLanguage: currentUser.preferredLanguage,
        text: textToSubmit
      });
    } catch (err: any) {
      console.error("Detailed send failure:", err);
      setError(`Send Failed: ${err.message || "Unknown error"}`);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setInputText(textToSubmit);
    }
  };

  const syncUserMetadata = async (updates: Partial<AppUser>) => {
    if (!currentUser) return;
    if (currentUser.isGuest) {
      const updatedGuest = { ...currentUser, ...updates };
      setCurrentUser(updatedGuest);
      localStorage.setItem('jeri_guest_user', JSON.stringify(updatedGuest));
      return;
    }
    const { data, error } = await supabase.auth.updateUser({ data: { ...updates } });
    if (!error && data.user) {
      const metadata = data.user.user_metadata;
      setCurrentUser(prev => prev ? ({ ...prev, ...metadata }) : null);
    }
  };

  const handleLanguageChange = (langCode: string) => {
    if (currentUser) syncUserMetadata({ preferredLanguage: langCode });
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (isLoginView) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (signInError) throw signInError;
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
          options: { data: { username: authUsername, preferredLanguage: onboardingLang, friends: [], friendRequests: [] } }
        });
        if (signUpError) throw signUpError;
        setSuccess("Account created! Check email or sign in.");
        setIsLoginView(true);
        setAuthPassword('');
      }
    } catch (err: any) { setError(err.message); } finally { setIsLoading(false); }
  };

  const startGuestMode = (e: React.FormEvent) => {
    e.preventDefault();
    const guestId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const guestUser: AppUser = {
      username: authUsername || `Guest-${guestId}`,
      email: `guest-${guestId}@jeri.chat`,
      preferredLanguage: onboardingLang,
      friends: [],
      friendRequests: [],
      isGuest: true
    };
    localStorage.setItem('jeri_guest_user', JSON.stringify(guestUser));
    setCurrentUser(guestUser);
    setIsGuestSetup(false);
    setActiveTab('rooms');
    setAuthUsername('');
    setOnboardingLang(DEFAULT_LANGUAGE);
    setError(null);
  };

  const logout = async () => {
    const wasGuest = currentUser?.isGuest;
    if (wasGuest) {
      localStorage.removeItem('jeri_guest_user');
    } else {
      await supabase.auth.signOut();
    }

    setCurrentUser(null);
    setCurrentRoom(null);
    setMessages([]);
    setAuthEmail('');
    setAuthPassword('');
    setAuthUsername('');
    setOnboardingLang(DEFAULT_LANGUAGE);
    setInputText('');
    setRoomInput('');
    setError(null);
    setSuccess(null);
    setActiveTab('rooms');
    setIsGuestSetup(false);
    setIsLoginView(true);
  };

  if (isLoading) return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  if (!currentUser) {
    if (isGuestSetup) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-indigo-600">
          <div className="w-full max-w-md bg-white rounded-3xl p-10 shadow-2xl">
            <button onClick={() => { setIsGuestSetup(false); setAuthUsername(''); setError(null); }} className="text-gray-500 hover:text-indigo-600 font-bold mb-6 transition-colors flex items-center">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              Back to Login
            </button>
            <h1 className="text-3xl font-black mb-6 text-indigo-950 tracking-tight italic">Guest Entry</h1>
            <form onSubmit={startGuestMode} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 ml-1 tracking-widest">Public Nickname</label>
                <input value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} placeholder="Choose a name..." className="w-full px-6 py-4 bg-gray-50 rounded-xl text-indigo-950 font-bold placeholder-gray-400 border-2 border-gray-100 focus:border-indigo-500 focus:bg-white outline-none transition-all" required />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 ml-1 tracking-widest">Preferred Language</label>
                <LanguageSelector value={onboardingLang} onChange={setOnboardingLang} className="text-indigo-950 font-bold border-2 border-gray-100 focus:border-indigo-500" />
              </div>
              <button type="submit" className="w-full py-4 bg-indigo-600 text-white font-black rounded-xl hover:bg-indigo-700 transition-all shadow-lg active:scale-95">Enter JERI</button>
            </form>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-indigo-600">
        <div className="w-full max-w-md bg-white rounded-3xl p-10 shadow-2xl">
          <h1 className="text-6xl font-black text-indigo-600 mb-8 tracking-tighter italic text-center">JERI</h1>
          {success && <p className="mb-4 text-sm text-green-700 font-bold bg-green-50 p-4 rounded-xl border-2 border-green-100 text-center">{success}</p>}
          <form onSubmit={handleAuth} className="space-y-4">
            {!isLoginView && (
              <input value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} placeholder="Username" className="w-full px-6 py-4 bg-gray-50 rounded-xl text-indigo-950 font-bold placeholder-gray-400 border-2 border-gray-100 focus:border-indigo-500 focus:bg-white outline-none transition-all" required />
            )}
            <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="Email" className="w-full px-6 py-4 bg-gray-50 rounded-xl text-indigo-950 font-bold placeholder-gray-400 border-2 border-gray-100 focus:border-indigo-500 focus:bg-white outline-none transition-all" required />
            <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Password" className="w-full px-6 py-4 bg-gray-50 rounded-xl text-indigo-950 font-bold placeholder-gray-400 border-2 border-gray-100 focus:border-indigo-500 focus:bg-white outline-none transition-all" required />
            {!isLoginView && <LanguageSelector value={onboardingLang} onChange={setOnboardingLang} className="text-indigo-950 font-bold" />}
            {error && <p className="text-xs text-red-600 font-bold bg-red-50 p-3 rounded-lg border-2 border-red-100 text-center">{error}</p>}
            <button type="submit" className="w-full py-4 bg-indigo-600 text-white font-black rounded-xl hover:bg-indigo-700 transition-all shadow-lg active:scale-95">{isLoginView ? 'Sign In' : 'Create Account'}</button>
          </form>
          <div className="mt-6 flex flex-col space-y-3 border-t pt-6">
            <button onClick={() => { setIsGuestSetup(true); setError(null); }} className="w-full py-4 bg-gray-50 text-indigo-950 font-black rounded-xl border-2 border-gray-100 hover:bg-gray-100 transition-colors shadow-sm">Join as Guest</button>
            <button onClick={() => { setIsLoginView(!isLoginView); setError(null); setAuthPassword(''); }} className="text-gray-500 text-sm font-bold text-center hover:text-indigo-600 transition-colors">
              {isLoginView ? "New here? Join the conversation" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-50 overflow-hidden font-sans">
      <aside className="w-20 md:w-64 bg-white border-r flex flex-col shadow-sm z-20">
        <div className="p-8 flex justify-center md:justify-start">
          <h1 className="text-2xl font-black text-indigo-600 tracking-tighter italic hidden md:block">JERI</h1>
          <div className="md:hidden w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black italic shadow-lg">J</div>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <button onClick={() => setActiveTab('rooms')} className={`w-full p-4 rounded-xl flex items-center justify-center md:justify-start space-x-3 transition-all ${activeTab === 'rooms' ? 'bg-indigo-600 text-white shadow-xl translate-x-1' : 'text-gray-500 font-bold hover:bg-gray-50'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span className="hidden md:block">Rooms</span>
          </button>
          <button onClick={() => setActiveTab('settings')} className={`w-full p-4 rounded-xl flex items-center justify-center md:justify-start space-x-3 transition-all ${activeTab === 'settings' ? 'bg-indigo-600 text-white shadow-xl translate-x-1' : 'text-gray-500 font-bold hover:bg-gray-50'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066" /></svg>
            <span className="hidden md:block">Settings</span>
          </button>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col relative bg-white">
        {!currentRoom ? (
          <div className="flex-1 p-10 bg-white overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-10">
              <header className="border-b pb-6">
                <h2 className="text-4xl font-black text-indigo-950 tracking-tight italic">Welcome, {currentUser.username}</h2>
                <p className="text-indigo-600 font-black uppercase tracking-widest text-[10px] mt-1">{currentUser.isGuest ? 'Guest Access' : 'Member Account'}</p>
              </header>
              {activeTab === 'rooms' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <button onClick={() => setCurrentRoom({ id: 'LOBBY', name: 'Global Lobby' })} className="p-10 bg-indigo-600 rounded-3xl text-left hover:scale-[1.01] hover:shadow-2xl transition-all group relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                      <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    </div>
                    <h3 className="text-2xl font-black text-white group-hover:translate-x-1 transition-transform relative z-10">Global Lobby</h3>
                    <p className="text-indigo-100 mt-2 text-sm font-medium relative z-10">Instant translation with the world.</p>
                  </button>
                  <div className="p-10 bg-gray-50 rounded-3xl border-2 border-gray-100">
                    <h3 className="text-2xl font-black text-indigo-950 mb-4 tracking-tight">Private Access</h3>
                    <div className="flex space-x-2">
                      <input value={roomInput} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} placeholder="ROOM-ID" className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-200 font-black text-indigo-950 placeholder-gray-400 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition-all uppercase" />
                      <button onClick={() => roomInput && setCurrentRoom({ id: roomInput.toUpperCase(), name: `Room ${roomInput}` })} className="px-6 py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-colors shadow-md active:scale-95">Go</button>
                    </div>
                  </div>
                </div>
              )}
              {activeTab === 'settings' && (
                <div className="max-w-xl bg-gray-50 p-10 rounded-3xl space-y-8 border-2 border-gray-100 shadow-sm">
                  <div className="space-y-4">
                    <label className="block text-xs font-black uppercase text-gray-400 tracking-widest">My Reading Language</label>
                    <LanguageSelector value={currentUser.preferredLanguage} onChange={handleLanguageChange} className="text-indigo-950 font-black shadow-sm" />
                  </div>
                  <div className="pt-8 border-t border-gray-200">
                    <button onClick={logout} className="px-8 py-4 bg-white text-red-600 rounded-xl border-2 border-red-100 font-black text-xs uppercase tracking-widest hover:bg-red-50 transition-all shadow-sm active:scale-95">
                      {currentUser.isGuest ? 'End Guest Session' : 'Logout'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full bg-white">
            <header className="px-8 py-5 border-b flex items-center justify-between bg-white z-10 shadow-sm">
              <div className="flex items-center space-x-4">
                <button onClick={() => { setCurrentRoom(null); setError(null); }} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className="flex flex-col">
                  <h2 className="font-black text-xl text-indigo-950 leading-none">{currentRoom.name}</h2>
                  <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mt-1">Live Feed</span>
                </div>
              </div>
              {error && (
                <div className="flex items-center space-x-2 bg-red-50 px-3 py-1.5 rounded-full border border-red-200 shadow-sm animate-in fade-in slide-in-from-top-2">
                  <span className="text-[10px] text-red-600 font-black uppercase">{error}</span>
                  <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 font-bold ml-1 px-1">✕</button>
                </div>
              )}
            </header>
            <main className="flex-1 overflow-y-auto px-8 py-6 space-y-4 bg-gray-50/50">
              {isHistoryLoading && <div className="text-center py-10 text-xs font-black text-gray-300 animate-pulse tracking-[0.2em]">CONNECTING...</div>}
              {messages.length === 0 && !isHistoryLoading && (
                <div className="text-center py-20">
                  <p className="text-sm font-bold text-gray-400 tracking-tight">Room is empty.</p>
                  <p className="text-[10px] uppercase font-black tracking-widest mt-1 text-gray-300 italic">Be the first to break the ice!</p>
                </div>
              )}
              {messages.map((msg) => <ChatBubble key={msg.id} message={msg} isOwn={msg.senderEmail === currentUser.email} targetLanguage={currentUser.preferredLanguage} />)}
              <div ref={messagesEndRef} />
            </main>
            <footer className="p-6 bg-white border-t">
              <form onSubmit={sendMessage} className="flex space-x-3 max-w-5xl mx-auto">
                <input value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Type in your language..." className="flex-1 px-6 py-4 rounded-2xl bg-gray-50 border-2 border-gray-100 text-indigo-950 font-bold placeholder-gray-400 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 focus:bg-white outline-none transition-all" />
                <button type="submit" disabled={!inputText.trim()} className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg hover:bg-indigo-700 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95">Send</button>
              </form>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
