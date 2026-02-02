
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, TranslatedMessage, ChatRoom } from './types';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './constants';
import { translateText } from './services/geminiService';
import { chatSync } from './services/chatSync';
import LanguageSelector from './components/LanguageSelector';
import ChatBubble from './components/ChatBubble';

const App: React.FC = () => {
  // --- Auth & User State ---
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('jeri_chat_active_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoginView, setIsLoginView] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [onboardingLang, setOnboardingLang] = useState(DEFAULT_LANGUAGE);

  // --- Chat State ---
  const [currentRoom, setCurrentRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<TranslatedMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [friendEmailInput, setFriendEmailInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'rooms' | 'friends' | 'settings'>('rooms');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Persistence for user updates
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('jeri_chat_active_user', JSON.stringify(currentUser));
      // In a real app, we'd sync this to a DB. Here we simulate it.
      const allUsers = JSON.parse(localStorage.getItem('jeri_chat_db_users') || '{}');
      allUsers[currentUser.email] = currentUser;
      localStorage.setItem('jeri_chat_db_users', JSON.stringify(allUsers));
    }
  }, [currentUser]);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Chat Logic ---
  const handleIncomingMessage = useCallback(async (msg: any) => {
    if (!currentUser) return;

    const newMessage: TranslatedMessage = {
      ...msg,
      isTranslating: msg.senderLanguage !== currentUser.preferredLanguage && msg.senderEmail !== currentUser.email
    };

    setMessages(prev => [...prev, newMessage]);

    if (newMessage.isTranslating) {
      try {
        const targetLangName = SUPPORTED_LANGUAGES.find(l => l.code === currentUser.preferredLanguage)?.name || currentUser.preferredLanguage;
        const sourceLangName = SUPPORTED_LANGUAGES.find(l => l.code === newMessage.senderLanguage)?.name || newMessage.senderLanguage;
        
        const translated = await translateText(newMessage.text, targetLangName, sourceLangName);
        
        setMessages(prev => prev.map(m => 
          m.id === newMessage.id ? { ...m, translatedText: translated, isTranslating: false } : m
        ));
      } catch (err) {
        setMessages(prev => prev.map(m => 
          m.id === newMessage.id ? { ...m, isTranslating: false } : m
        ));
      }
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentRoom) {
      chatSync.connect(currentRoom.id);
      const unsub = chatSync.onMessage(handleIncomingMessage);
      return () => {
        unsub();
        chatSync.disconnect();
      };
    }
  }, [currentRoom, handleIncomingMessage]);

  // --- Actions ---
  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const db = JSON.parse(localStorage.getItem('jeri_chat_db_users') || '{}');

    if (isLoginView) {
      const user = db[authEmail];
      if (user && user.password === authPassword) {
        setCurrentUser(user);
      } else {
        setError("Invalid email or password");
      }
    } else {
      if (!authUsername.trim()) {
        setError("Username is required");
        return;
      }
      if (db[authEmail]) {
        setError("Email already registered");
        return;
      }

      // Advanced Password Validation
      const hasUpper = /[A-Z]/.test(authPassword);
      const hasLower = /[a-z]/.test(authPassword);
      const hasNumber = /[0-9]/.test(authPassword);
      const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(authPassword);
      
      if (authPassword.length < 8) {
        setError("Password must be at least 8 characters long");
        return;
      }
      if (!hasUpper) {
        setError("Password must contain at least one uppercase letter");
        return;
      }
      if (!hasLower || !hasNumber) {
        setError("Password must contain both letters and numbers");
        return;
      }
      if (!hasSpecial) {
        setError("Password must contain at least one special character (e.g., !, @, #, $)");
        return;
      }
      
      if (authPassword !== authConfirmPassword) {
        setError("Passwords do not match");
        return;
      }

      const newUser: User & { password?: string } = {
        username: authUsername,
        email: authEmail,
        preferredLanguage: onboardingLang,
        friends: [],
        friendRequests: [],
        password: authPassword
      };
      db[authEmail] = newUser;
      localStorage.setItem('jeri_chat_db_users', JSON.stringify(db));
      setCurrentUser(newUser);
    }
  };

  const handleAddFriend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !friendEmailInput.trim()) return;
    if (friendEmailInput === currentUser.email) {
      setError("You cannot add yourself");
      return;
    }
    if (currentUser.friends.includes(friendEmailInput)) {
      setError("Already a friend");
      return;
    }

    // Mock direct addition
    setCurrentUser(prev => prev ? ({
      ...prev,
      friends: [...new Set([...prev.friends, friendEmailInput])]
    }) : null);
    setFriendEmailInput('');
    setError(null);
  };

  const startDirectChat = (friendEmail: string) => {
    if (!currentUser) return;
    const sorted = [currentUser.email, friendEmail].sort();
    const roomId = `DM_${sorted[0]}_${sorted[1]}`.replace(/[^a-zA-Z0-9]/g, '');
    setCurrentRoom({ id: roomId, name: friendEmail, isDirect: true });
    setMessages([]);
  };

  const createRoom = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setCurrentRoom({ id, name: `Room ${id}` });
    setMessages([]);
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomInput.trim()) return;
    setCurrentRoom({ id: roomInput.trim().toUpperCase(), name: `Room ${roomInput.toUpperCase()}` });
    setMessages([]);
    setRoomInput('');
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !currentUser || !currentRoom) return;

    const msg = {
      id: Date.now().toString(),
      sender: currentUser.username,
      senderEmail: currentUser.email,
      senderLanguage: currentUser.preferredLanguage,
      text: inputText,
      timestamp: Date.now()
    };

    chatSync.broadcast(msg);
    setMessages(prev => [...prev, { ...msg, isTranslating: false }]);
    setInputText('');
  };

  const logout = () => {
    setCurrentUser(null);
    setCurrentRoom(null);
    localStorage.removeItem('jeri_chat_active_user');
  };

  const handleLanguageChange = (newLang: string) => {
    if (!currentUser) return;
    setCurrentUser({ ...currentUser, preferredLanguage: newLang });
  };

  // --- UI Components ---
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden p-8 animate-in fade-in duration-500">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-black text-indigo-600 mb-2 tracking-tighter">JERI Chat</h1>
            <p className="text-gray-500">{isLoginView ? 'Welcome back!' : 'Create your account'}</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {!isLoginView && (
              <div className="animate-in slide-in-from-top-2 duration-300">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900 focus:outline-none transition-all"
                  placeholder="CoolName123"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900 focus:outline-none transition-all"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900 focus:outline-none transition-all"
                placeholder="••••••••"
                required
              />
              {!isLoginView && (
                <div className="mt-2 text-[10px] text-gray-400 grid grid-cols-2 gap-x-2 gap-y-1">
                  <span className={authPassword.length >= 8 ? "text-green-500" : ""}>• 8+ characters</span>
                  <span className={/[A-Z]/.test(authPassword) ? "text-green-500" : ""}>• Capital letter</span>
                  <span className={(/[0-9]/.test(authPassword) && /[a-zA-Z]/.test(authPassword)) ? "text-green-500" : ""}>• Letters & Numbers</span>
                  <span className={/[!@#$%^&*(),.?":{}|<>]/.test(authPassword) ? "text-green-500" : ""}>• Special character</span>
                </div>
              )}
            </div>

            {!isLoginView && (
              <div className="animate-in slide-in-from-top-2 duration-300 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    value={authConfirmPassword}
                    onChange={(e) => setAuthConfirmPassword(e.target.value)}
                    className={`w-full px-4 py-3 border ${authConfirmPassword && authPassword !== authConfirmPassword ? 'border-red-400' : 'border-gray-200'} rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900 focus:outline-none transition-all`}
                    placeholder="••••••••"
                    required
                  />
                  {authConfirmPassword && authPassword !== authConfirmPassword && (
                    <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords do not match yet.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Your Preferred Language</label>
                  <LanguageSelector 
                    value={onboardingLang} 
                    onChange={setOnboardingLang}
                    className="py-3"
                  />
                </div>
              </div>
            )}

            {error && <div className="p-3 bg-red-50 border border-red-100 rounded-xl"><p className="text-red-600 text-xs font-bold text-center">{error}</p></div>}

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-[0.98]"
            >
              {isLoginView ? 'Login' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button 
              onClick={() => { setIsLoginView(!isLoginView); setError(null); setAuthPassword(''); setAuthConfirmPassword(''); }}
              className="text-indigo-600 text-sm font-semibold hover:underline transition-all"
            >
              {isLoginView ? "Don't have an account? Sign up" : "Already have an account? Log in"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-100 overflow-hidden">
      {/* Navigation Sidebar */}
      <aside className="w-20 md:w-64 bg-white border-r border-gray-200 flex flex-col shadow-xl z-20">
        <div className="p-6 border-b border-gray-100 hidden md:block">
          <h1 className="text-2xl font-black text-indigo-600 tracking-tighter italic">JERI Chat</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <button 
            onClick={() => setActiveTab('rooms')}
            className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-all ${activeTab === 'rooms' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            <span className="hidden md:block font-bold">Rooms</span>
          </button>
          <button 
            onClick={() => setActiveTab('friends')}
            className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-all ${activeTab === 'friends' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
            <span className="hidden md:block font-bold">Friends</span>
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span className="hidden md:block font-bold">Settings</span>
          </button>
        </nav>

        <div className="p-4 border-t border-gray-100 flex flex-col items-center md:items-start space-y-4">
          <div className="flex items-center space-x-3 px-2">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold uppercase ring-2 ring-indigo-50 ring-offset-2">
              {currentUser.username[0]}
            </div>
            <div className="hidden md:block overflow-hidden">
              <p className="text-sm font-black text-gray-900 truncate">{currentUser.username}</p>
              <p className="text-[10px] text-gray-400 truncate font-medium">{currentUser.email}</p>
            </div>
          </div>
          <button onClick={logout} className="hidden md:block text-xs text-red-500 font-bold hover:bg-red-50 px-3 py-2.5 rounded-xl transition-all w-full text-left">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {!currentRoom ? (
          <div className="flex-1 flex flex-col p-8 bg-gray-50/50 overflow-y-auto">
            {activeTab === 'rooms' && (
              <div className="max-w-4xl mx-auto w-full space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                <header>
                  <h2 className="text-4xl font-black text-gray-900 tracking-tight">Public Spaces</h2>
                  <p className="text-gray-500 font-medium">Create a new hub or enter a Room ID.</p>
                </header>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <button onClick={createRoom} className="group p-10 bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl hover:border-indigo-400 transition-all text-left space-y-5">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-inner"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg></div>
                    <div>
                      <h3 className="font-black text-gray-900 text-2xl">Start Fresh Room</h3>
                      <p className="text-gray-400 font-medium mt-1">Instant global interaction with auto-translate.</p>
                    </div>
                  </button>
                  <div className="p-10 bg-white rounded-3xl border border-gray-100 shadow-sm space-y-5">
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-600 shadow-inner"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg></div>
                    <form onSubmit={joinRoom} className="space-y-4">
                      <h3 className="font-black text-gray-900 text-2xl">Join a Space</h3>
                      <input 
                        value={roomInput} 
                        onChange={(e) => setRoomInput(e.target.value)} 
                        className="w-full px-5 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:outline-none uppercase text-gray-900 font-bold tracking-widest placeholder:normal-case placeholder:tracking-normal placeholder:font-normal" 
                        placeholder="Type ID here..." 
                      />
                      <button type="submit" className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black hover:bg-black transition-all shadow-lg active:scale-[0.98]">Join Room</button>
                    </form>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'friends' && (
              <div className="max-w-4xl mx-auto w-full space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                <header>
                  <h2 className="text-4xl font-black text-gray-900 tracking-tight">My Contacts</h2>
                  <p className="text-gray-500 font-medium">Private 1-on-1 translation at your fingertips.</p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="md:col-span-1 space-y-6">
                    <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm space-y-5">
                      <h3 className="font-black text-gray-900 text-xl">Quick Add</h3>
                      <form onSubmit={handleAddFriend} className="space-y-4">
                        <input 
                          type="email" 
                          value={friendEmailInput} 
                          onChange={(e) => setFriendEmailInput(e.target.value)}
                          className="w-full px-5 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:outline-none text-sm text-gray-900" 
                          placeholder="friend@email.com"
                        />
                        <button type="submit" className="w-full py-3.5 bg-indigo-600 text-white rounded-2xl font-black text-sm hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">Add Friend</button>
                        {error && <p className="text-xs text-red-500 font-bold px-1">{error}</p>}
                      </form>
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-5">
                    <h3 className="font-black text-gray-400 uppercase text-[10px] tracking-[0.2em] px-2">Your Connections</h3>
                    {currentUser.friends.length === 0 ? (
                      <div className="p-16 text-center bg-white rounded-3xl border-2 border-dashed border-gray-100">
                        <p className="text-gray-400 font-medium">Start building your network.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {currentUser.friends.map(friendEmail => (
                          <button 
                            key={friendEmail}
                            onClick={() => startDirectChat(friendEmail)}
                            className="flex items-center justify-between p-6 bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-indigo-300 transition-all text-left group"
                          >
                            <div className="flex items-center space-x-4">
                              <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-black group-hover:bg-indigo-600 group-hover:text-white transition-all">{friendEmail[0].toUpperCase()}</div>
                              <div>
                                <p className="font-black text-gray-900">{friendEmail}</p>
                                <p className="text-xs text-gray-400 font-medium">Click to chat instantly</p>
                              </div>
                            </div>
                            <svg className="w-6 h-6 text-gray-300 group-hover:text-indigo-400 transform group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="max-w-2xl mx-auto w-full space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                <header>
                  <h2 className="text-4xl font-black text-gray-900 tracking-tight">Preferences</h2>
                  <p className="text-gray-500 font-medium">Personalize your interaction experience.</p>
                </header>
                <div className="bg-white p-10 rounded-3xl border border-gray-100 shadow-sm space-y-8">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-3">Translation Target Language</label>
                    <LanguageSelector 
                      value={currentUser.preferredLanguage} 
                      onChange={handleLanguageChange} 
                    />
                    <p className="mt-3 text-xs text-gray-400 font-medium">We'll convert every incoming message into this language automatically.</p>
                  </div>
                  <div className="pt-8 border-t border-gray-100">
                    <button onClick={logout} className="px-8 py-3 bg-red-50 text-red-600 font-black rounded-2xl hover:bg-red-100 transition-colors text-sm">Delete Local Session</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Chat View */
          <div className="flex-1 flex flex-col h-full bg-white animate-in fade-in zoom-in-95 duration-300">
            <header className="px-8 py-5 border-b border-gray-100 flex items-center justify-between bg-white/95 backdrop-blur-xl sticky top-0 z-10 shadow-sm">
              <div className="flex items-center space-x-5">
                <button onClick={() => setCurrentRoom(null)} className="p-3 hover:bg-gray-100 rounded-2xl transition-all text-gray-500 hover:text-indigo-600 bg-gray-50 border border-gray-100">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div>
                  <h2 className="font-black text-gray-900 text-xl tracking-tight">{currentRoom.isDirect ? `Chat: ${currentRoom.name}` : `Space: ${currentRoom.id}`}</h2>
                  <div className="flex items-center space-x-2 text-[10px] text-gray-400 mt-0.5 font-bold uppercase tracking-wider">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    <span>Gemini Bridge: {SUPPORTED_LANGUAGES.find(l => l.code === currentUser.preferredLanguage)?.name}</span>
                  </div>
                </div>
              </div>
              <div className="hidden sm:flex items-center space-x-3">
                <div className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-2xl text-[11px] font-black uppercase tracking-widest border border-indigo-100 shadow-inner">{currentUser.preferredLanguage} MODE</div>
              </div>
            </header>

            <main className="flex-1 overflow-y-auto p-8 space-y-4 bg-gray-50/20">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                  <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-6 text-gray-300">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>
                  </div>
                  <p className="font-black text-gray-600 text-lg">No interaction history yet.</p>
                  <p className="text-sm text-gray-400 mt-2 font-medium">Messages are instantly translated for everyone.</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <ChatBubble 
                    key={msg.id} 
                    message={msg} 
                    isOwn={msg.senderEmail === currentUser.email}
                    targetLanguage={currentUser.preferredLanguage}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </main>

            <footer className="p-6 bg-white border-t border-gray-100">
              <form onSubmit={sendMessage} className="flex items-center space-x-4 max-w-5xl mx-auto">
                <input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Share your thoughts in any language..."
                  className="flex-1 bg-gray-50 border border-gray-100 px-8 py-5 rounded-[2.5rem] focus:ring-4 focus:ring-indigo-100 focus:outline-none focus:bg-white focus:border-indigo-200 transition-all text-sm text-gray-900 shadow-inner font-medium"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white p-5 rounded-full shadow-xl shadow-indigo-100 transition-all active:scale-90 flex items-center justify-center"
                >
                  <svg className="w-6 h-6 rotate-90" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
                </button>
              </form>
              <div className="flex justify-center mt-4">
                <span className="text-[10px] text-gray-300 font-bold uppercase tracking-[0.3em]">JERI Chat Engine v1.0</span>
              </div>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
