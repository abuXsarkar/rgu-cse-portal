import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, onAuthStateChanged, User as FirebaseUser, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, Firestore, collection, addDoc, onSnapshot, query, orderBy, doc, setDoc, getDoc, Timestamp, serverTimestamp, setLogLevel } from 'firebase/firestore';
import { AlertTriangle, Award, Bell, Briefcase, CalendarDays, CheckCircle, Building2, Image as ImageIcon, Info, Library, LogIn, LogOut, MessageCircle as MessageCircleIcon, PlusCircle, RefreshCw, Send, Settings, ShieldCheck, UserCircle, UserPlus, XCircle } from 'lucide-react';

// --- 1. GLOBAL DECLARATIONS & ENVIRONMENT VARIABLES ---
declare global {
  var __app_id: string | undefined;
  var __firebase_config: string | undefined;
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'cse-rgu-prod-final';
const firebaseConfigStr = typeof __firebase_config !== 'undefined' ? __firebase_config : JSON.stringify({
  apiKey: "YOUR_FALLBACK_API_KEY",
  authDomain: "YOUR_FALLBACK_AUTH_DOMAIN",
  projectId: "YOUR_FALLBACK_PROJECT_ID",
  storageBucket: "YOUR_FALLBACK_STORAGE_BUCKET",
  messagingSenderId: "YOUR_FALLBACK_MESSAGING_SENDER_ID",
  appId: "YOUR_FALLBACK_APP_ID"
});

// --- 2. TYPE DEFINITIONS & CONFIGURATIONS ---
type UserRole = 'student' | 'cr' | 'professor' | 'hod' | 'admin';
type UserStatus = 'pending' | 'approved' | 'rejected';
type AccountType = 'student' | 'professor';
type Course = 'BTech-CSE' | 'BTech-CSE/AI';
type PostType = 'announcement' | 'event' | 'achievement';
type ViewType = PostType | 'home' | 'chat' | 'library' | 'gallery' | 'about' | 'admin_panel';
interface UserProfile { uid: string; displayName?: string; email?: string; photoURL?: string; role: UserRole; status: UserStatus; createdAt: Timestamp; lastSeen?: Timestamp; mobileNo?: string; course?: Course; semester?: string; rollNo?: string; }
interface Announcement { id: string; title: string; content: string; authorId: string; authorName: string; authorRole: UserRole; createdAt: Timestamp; }
interface EventItem { id: string; title: string; description: string; eventDate: Timestamp; location: string; authorId: string; authorName: string; authorRole: UserRole; createdAt: Timestamp; }
interface Achievement { id: string; studentName: string; description: string; achievedDate: Timestamp; authorId: string; authorName: string; authorRole: UserRole; createdAt: Timestamp; }
interface ChatMessage { id: string; text: string; authorId: string; authorName: string; authorRole: UserRole; authorPhotoURL?: string; createdAt: Timestamp; }
type ModalState = { isOpen: boolean; type: PostType | null; };
const NAV_ITEMS: { name: string; view: ViewType; icon: React.ReactElement, adminOnly?: boolean }[] = [
  { name: 'Home', view: 'home', icon: <Briefcase size={18}/> },
  { name: 'Announcements', view: 'announcement', icon: <Bell size={18}/> },
  { name: 'Events', view: 'event', icon: <CalendarDays size={18}/> },
  { name: 'Achievements', view: 'achievement', icon: <Award size={18}/> },
  { name: 'Chat', view: 'chat', icon: <MessageCircleIcon size={18}/> },
  { name: 'Library', view: 'library', icon: <Library size={18}/> },
  { name: 'Gallery', view: 'gallery', icon: <ImageIcon size={18}/> },
  { name: 'About', view: 'about', icon: <Info size={18}/> },
  { name: 'Admin Panel', view: 'admin_panel', icon: <ShieldCheck size={18}/>, adminOnly: true },
];
const ROLES_CONFIG: Record<UserRole, { name: string; color: string; textColor?: string; }> = {
  student: { name: 'Student', color: 'bg-blue-500', textColor: 'text-blue-50' },
  cr: { name: 'CR', color: 'bg-green-500', textColor: 'text-green-50' },
  professor: { name: 'Professor', color: 'bg-purple-600', textColor: 'text-purple-50' },
  hod: { name: 'HOD', color: 'bg-red-600', textColor: 'text-red-50' },
  admin: { name: 'Admin', color: 'bg-yellow-500', textColor: 'text-yellow-900' },
};
const SEMESTERS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

// --- 3. STATE MANAGEMENT (React Context) ---
interface IAuthContext {
  currentUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  isAuthReady: boolean;
}
const AuthContext = createContext<IAuthContext>({ currentUser: null, userProfile: null, isAuthReady: false });
const useAuth = () => useContext(AuthContext);

// --- 4. FIREBASE INITIALIZATION ---
let firebaseApp: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
try {
  const parsedConfig = JSON.parse(firebaseConfigStr);
  if (parsedConfig.projectId && parsedConfig.projectId !== "YOUR_FALLBACK_PROJECT_ID") {
    firebaseApp = initializeApp(parsedConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    setLogLevel('debug');
  } else {
    console.warn("Using fallback Firebase config.");
  }
} catch (error) { console.error("Fatal Error initializing Firebase.", error); }

// --- 5. REUSABLE UI COMPONENTS ---
const Spinner: React.FC<{ size?: 'sm' | 'md' | 'lg'; text?: string }> = ({ size = 'md', text }) => (
  <div className="flex flex-col items-center justify-center p-4"><RefreshCw className={`animate-spin text-indigo-400 ${{ sm: 'h-6 w-6', md: 'h-12 w-12', lg: 'h-16 w-16' }[size]}`} />{text && <p className="mt-4 text-xl text-slate-300">{text}</p>}</div>
);
const RoleBadge: React.FC<{ role: UserRole }> = ({ role }) => {
  const current = ROLES_CONFIG[role] || { name: 'User', color: 'bg-gray-500' };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white ${current.color}`}>{current.name}</span>;
};
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => <div className={`bg-slate-800/80 backdrop-blur-sm shadow-xl rounded-xl p-6 md:p-8 transition-all duration-300 ${className}`}>{children}</div>;
const Alert: React.FC<{ type: 'error' | 'success' | 'info'; message: string }> = ({ type, message }) => {
  const styles = { error: { bg: 'bg-red-900/50', text: 'text-red-300', border: 'border-red-700', icon: <XCircle className="h-5 w-5 mr-3"/> }, success: { bg: 'bg-green-900/50', text: 'text-green-300', border: 'border-green-700', icon: <CheckCircle className="h-5 w-5 mr-3"/> }, info: { bg: 'bg-blue-900/50', text: 'text-blue-300', border: 'border-blue-700', icon: <Info className="h-5 w-5 mr-3"/> }};
  const current = styles[type];
  return <div className={`mt-4 p-4 ${current.bg} ${current.text} border ${current.border} rounded-lg flex items-center animate-fadeIn`}>{current.icon}{message}</div>;
};

// --- 6. CORE FEATURE COMPONENTS ---

const AuthPage: React.FC = () => {
    const [isLoginView, setIsLoginView] = useState(true);
    const [accountType, setAccountType] = useState<AccountType>('student');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        email: '', password: '', displayName: '', mobileNo: '', rollNo: '', semester: '1st', course: 'BTech-CSE' as Course
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleAuthAction = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!auth || !db) { setError("Authentication service not available."); return; }
        setLoading(true);
        setError(null);
        
        try {
            if (isLoginView) {
                await signInWithEmailAndPassword(auth, formData.email, formData.password);
            } else { // Signup logic
                if(!formData.displayName.trim()) throw new Error("Display Name is required.");
                const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
                const user = userCredential.user;
                
                let userProfileData: Omit<UserProfile, 'lastSeen'> = {
                    uid: user.uid,
                    displayName: formData.displayName,
                    email: user.email || '',
                    mobileNo: formData.mobileNo,
                    role: accountType,
                    status: 'pending',
                    createdAt: serverTimestamp() as Timestamp,
                };
                
                if (accountType === 'student') {
                    userProfileData = {
                        ...userProfileData,
                        rollNo: formData.rollNo,
                        semester: formData.semester,
                        course: formData.course
                    };
                }
                
                await setDoc(doc(db, `artifacts/${appId}/users/${user.uid}/profile/data`), userProfileData);
            }
        } catch (err: any) {
            console.error("Auth Error:", err);
            const friendlyMessage = err.code ? err.code.replace('auth/', '').replace(/-/g, ' ') : "An unknown error occurred.";
            setError(friendlyMessage.charAt(0).toUpperCase() + friendlyMessage.slice(1));
        } finally {
            setLoading(false);
        }
    };

    const commonInputClass = "w-full p-3 bg-slate-700 border border-slate-600 rounded-lg text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all";
    const commonLabelClass = "block text-slate-300 text-sm font-bold mb-2";

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center p-4">
            <Card className="max-w-md w-full">
                <div className="flex justify-center mb-6"><Building2 className="h-16 w-16 text-indigo-400" /></div>
                <div className="flex justify-center border-b border-slate-700 mb-6">
                    <button onClick={() => { setIsLoginView(true); setError(null); }} className={`px-6 py-3 font-semibold transition-all ${isLoginView ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-400'}`}>Login</button>
                    <button onClick={() => { setIsLoginView(false); setError(null); }} className={`px-6 py-3 font-semibold transition-all ${!isLoginView ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-400'}`}>Sign Up</button>
                </div>
                
                <h1 className="text-3xl font-bold text-white mb-2 text-center">{isLoginView ? "Welcome Back" : "Create Account"}</h1>
                <p className="text-slate-400 mb-8 text-center">{isLoginView ? "Sign in to access the portal." : "Your account will require admin approval."}</p>

                <form onSubmit={handleAuthAction} className="space-y-4">
                    {!isLoginView && (
                        <div className="flex bg-slate-700 rounded-lg p-1 mb-4">
                            <button type="button" onClick={() => setAccountType('student')} className={`w-1/2 rounded-md py-2 font-semibold transition-colors ${accountType === 'student' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}>I am a Student</button>
                            <button type="button" onClick={() => setAccountType('professor')} className={`w-1/2 rounded-md py-2 font-semibold transition-colors ${accountType === 'professor' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-600'}`}>I am a Professor</button>
                        </div>
                    )}
                    
                    {!isLoginView && <div><label className={commonLabelClass} htmlFor="displayName">Full Name</label><input type="text" name="displayName" onChange={handleChange} value={formData.displayName} className={commonInputClass} required /></div>}
                    <div><label className={commonLabelClass} htmlFor="email">Email Address</label><input type="email" name="email" onChange={handleChange} value={formData.email} className={commonInputClass} required /></div>
                    <div><label className={commonLabelClass} htmlFor="password">Password</label><input type="password" name="password" onChange={handleChange} value={formData.password} className={commonInputClass} required /></div>
                    {!isLoginView && <div><label className={commonLabelClass} htmlFor="mobileNo">Mobile No.</label><input type="tel" name="mobileNo" onChange={handleChange} value={formData.mobileNo} className={commonInputClass} required /></div>}
                    
                    {!isLoginView && accountType === 'student' && (
                        <div className="space-y-4 p-4 border border-slate-700 rounded-lg animate-fadeIn">
                            <div><label className={commonLabelClass} htmlFor="rollNo">Roll No.</label><input type="text" name="rollNo" onChange={handleChange} value={formData.rollNo} className={commonInputClass} required /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className={commonLabelClass} htmlFor="semester">Semester</label><select name="semester" onChange={handleChange} value={formData.semester} className={commonInputClass} required><option value="" disabled>Select</option>{SEMESTERS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                                <div><label className={commonLabelClass} htmlFor="course">Course</label><select name="course" onChange={handleChange} value={formData.course} className={commonInputClass} required><option value="BTech-CSE">BTech-CSE</option><option value="BTech-CSE/AI">BTech-CSE/AI</option></select></div>
                            </div>
                        </div>
                    )}
                    
                    {error && <Alert type="error" message={error} />}
                    
                    <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors disabled:opacity-50">
                        {loading ? <Spinner size="sm" /> : (isLoginView ? <LogIn size={20}/> : <UserPlus size={20}/>)}
                        {loading ? 'Processing...' : (isLoginView ? 'Login' : 'Sign Up')}
                    </button>
                </form>
            </Card>
        </div>
    );
};

const PendingApprovalPage: React.FC = () => (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-6"/>
            <h1 className="text-3xl font-bold text-white mb-2">Registration Received!</h1>
            <p className="text-slate-400 mb-8">Your account has been created and is now awaiting approval from a CR, HOD, or Admin. Please check back later.</p>
            <button onClick={() => auth && signOut(auth)} className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
                <LogOut size={20}/> Logout
            </button>
        </Card>
    </div>
);

const HomePage: React.FC = () => {
  const { userProfile, currentUser } = useAuth();
  return (
    <Card>
      <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-500 mb-6">Welcome, {userProfile?.displayName}!</h2>
      <p className="text-lg text-slate-300 mb-4">You are now logged in. Explore the portal using the navigation menu.</p>
      {/* Role switcher can be added here for demo purposes if needed */}
    </Card>
  );
};

const ChatPage: React.FC = () => {
    const { currentUser, userProfile } = useAuth();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const messagesEndRef = useRef<null | HTMLDivElement>(null);
    const channelId = 'public_general_chat';

    useEffect(() => {
        if (!db) return;
        setIsLoading(true);
        const chatCollectionPath = `artifacts/${appId}/public/data/chat_channels/${channelId}/messages`;
        const q = query(collection(db, chatCollectionPath), orderBy('createdAt', 'asc'), { limit: 100 });
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage)));
            setIsLoading(false);
        }, (error) => { console.error("Chat Error: ", error); setIsLoading(false); });
        return () => unsubscribe();
    }, [channelId]);
    
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!db || !currentUser || !userProfile || !newMessage.trim()) return;
        const chatCollectionPath = `artifacts/${appId}/public/data/chat_channels/${channelId}/messages`;
        try {
            await addDoc(collection(db, chatCollectionPath), {
                text: newMessage,
                authorId: currentUser.uid,
                authorName: userProfile.displayName || `User-${currentUser.uid.substring(0,5)}`,
                authorRole: userProfile.role,
                authorPhotoURL: userProfile.photoURL || '',
                createdAt: serverTimestamp()
            });
            setNewMessage('');
        } catch (error) { console.error("Failed to send message:", error); }
    };
    
    return (
        <Card className="flex flex-col h-[75vh]">
            <div className="flex items-center mb-4 pb-4 border-b border-slate-700">
                <MessageCircleIcon className="h-8 w-8 mr-3 text-indigo-400" />
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-500">Community Chat</h2>
            </div>
            <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                {isLoading && <Spinner text="Loading messages..."/>}
                {!isLoading && messages.map(msg => (
                    <div key={msg.id} className="flex items-start gap-3">
                        <img src={msg.authorPhotoURL || `https://placehold.co/40x40/64748b/FFFFFF?text=${msg.authorName?.[0] || 'U'}`} alt={msg.authorName} className="h-10 w-10 rounded-full flex-shrink-0"/>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-indigo-300">{msg.authorName}</span>
                                <RoleBadge role={msg.authorRole} />
                            </div>
                            <p className="text-slate-200">{msg.text}</p>
                        </div>
                    </div>
                ))}
                 <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleSendMessage} className="mt-4 flex gap-3">
                <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type your message..." className="flex-grow p-3 bg-slate-700 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" disabled={!currentUser}/>
                <button type="submit" className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50" disabled={!currentUser || !newMessage.trim()}><Send size={18}/> Send</button>
            </form>
        </Card>
    );
};

const ContentList: React.FC<{ type: PostType; items: any[]; title: string; icon: React.ReactElement; openModal: (type: PostType) => void; userProfile: UserProfile | null; error: string | null; }> = 
({ type, items, title, icon, openModal, userProfile, error }) => {
  const canPost = userProfile && ['cr', 'hod', 'professor'].includes(userProfile.role);
  const formatDate = (timestamp: Timestamp | undefined | null): string => !timestamp ? 'N/A' : new Date(timestamp.seconds * 1000).toLocaleDateString();

  return (
    <Card>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 pb-4 border-b border-slate-700">
        <div className="flex items-center mb-4 sm:mb-0">{React.cloneElement(icon, { className: "h-10 w-10 mr-4" })}<h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-500">{title}</h2></div>
        {canPost && (<button onClick={() => openModal(type)} className="flex items-center bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:shadow-lg transition duration-150 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-opacity-75"><PlusCircle size={20} className="mr-2" /> Create New {type.charAt(0).toUpperCase() + type.slice(1)}</button>)}
      </div>
      {error && <Alert type="error" message={error} />}
      {!error && items.length === 0 ? (<div className="text-center py-12"><Info size={48} className="mx-auto text-slate-500 mb-4" /><p className="text-xl text-slate-400">No {type}s posted yet.</p>{canPost && <p className="text-slate-500 mt-2">Be the first to add one!</p>}</div>
      ) : (<div className="space-y-6">{items.map((item) => (
        <div key={item.id} className="bg-slate-700/50 p-6 rounded-lg shadow-lg hover:shadow-xl transition-shadow duration-300 ease-in-out">
          <h3 className="text-2xl font-semibold text-indigo-300 mb-2">{item.title || item.studentName}</h3>
          {type === 'announcement' && <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">{item.content}</p>}
          {type === 'event' && (<> <p className="text-slate-300 mb-1 leading-relaxed whitespace-pre-wrap">{item.description}</p> <p className="text-sm text-indigo-400"><strong className="text-slate-400">Date:</strong> {formatDate(item.eventDate)}</p> <p className="text-sm text-indigo-400"><strong className="text-slate-400">Location:</strong> {item.location}</p> </>)}
          {type === 'achievement' && (<> <p className="text-slate-300 mb-1 leading-relaxed whitespace-pre-wrap">{item.description}</p> <p className="text-sm text-indigo-400"><strong className="text-slate-400">Achieved on:</strong> {formatDate(item.achievedDate)}</p> </>)}
          <div className="mt-4 pt-3 border-t border-slate-600 text-xs text-slate-500 flex items-center"><p className="mr-2">Posted by: <span className="font-medium text-slate-400">{item.authorName || 'N/A'}</span></p>{item.authorRole && <RoleBadge role={item.authorRole} />}</div>
          <p className="text-xs text-slate-500 mt-1">Posted on: <span className="font-medium text-slate-400">{formatDate(item.createdAt)}</span></p>
        </div>
      ))}</div>)}
    </Card>
  );
};

const AboutPage: React.FC = () => (
    <Card>
      <div className="flex items-center mb-6 pb-4 border-b border-slate-700"><Info className="h-10 w-10 mr-4 text-indigo-400" /><h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-500">About This Platform</h2></div>
      <div className="space-y-4 leading-relaxed text-slate-300"><p>This platform is a dedicated community hub for the students and faculty of the <strong className="text-white">Computer Science and Engineering (CSE) Department, Royal School Of Engineering Technology (RSET)</strong>, at <strong className="text-indigo-300">The Assam Royal Global University, Guwahati.</strong></p><h3 className="text-xl font-semibold text-indigo-300 pt-4">Development Credits:</h3><p>This platform concept and initial design are by <strong className="text-indigo-300">Abu Sufian Sarkar</strong>, a student of the CSE Department.</p></div>
    </Card>
);

const PlaceholderPage: React.FC<{ title: string; icon: React.ReactElement; description: string }> = ({ title, icon, description }) => (
    <Card className="text-center">
      <div className="flex justify-center items-center mb-6">{React.cloneElement(icon, { size: 48, className: "text-indigo-400"})}</div>
      <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-500 mb-4">{title}</h2>
      <p className="text-lg text-slate-400 mb-2">Coming Soon!</p><p className="text-md text-slate-500 leading-relaxed max-w-2xl mx-auto">{description}</p>
      <div className="mt-8 p-4 border border-dashed border-slate-600 rounded-lg bg-slate-700/50"><h4 className="font-semibold text-indigo-300 mb-2">Technical Vision:</h4><p className="text-sm text-slate-400">This module will be built using Firebase Storage for uploads and Firebase Functions for processing.</p></div>
    </Card>
);

const CreatePostModal: React.FC<{ type: PostType | null; isOpen: boolean; onClose: () => void; onSubmit: (formData: any) => void; userProfile: UserProfile | null; }> = ({ type, isOpen, onClose, onSubmit, userProfile }) => {
  const [formData, setFormData] = useState<any>({});
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => { setFormData({}); setFormError(null); }, [isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let processedData = {...formData};
    // Simple validation
    if (!processedData.title && !processedData.studentName) { setFormError("A title or student name is required."); return; }
    // Convert dates to Timestamps
    if (processedData.eventDate) processedData.eventDate = Timestamp.fromDate(new Date(processedData.eventDate));
    if (processedData.achievedDate) processedData.achievedDate = Timestamp.fromDate(new Date(processedData.achievedDate));
    onSubmit(processedData);
  };

  if (!isOpen || !type) return null;
  const commonInputClass = "w-full p-3 bg-slate-700 border border-slate-600 rounded-lg text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors duration-150";
  const commonLabelClass = "block text-sm font-medium text-slate-300 mb-1";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
      <div className="bg-slate-800 p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative transform transition-all duration-300 ease-out scale-95 opacity-0 animate-modalEnter">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"><XCircle size={28} /></button>
        <h2 className="text-2xl sm:text-3xl font-bold text-indigo-400 mb-6 text-center">Create New {type.charAt(0).toUpperCase() + type.slice(1)}</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
            {type === 'announcement' && (<><div><label htmlFor="title" className={commonLabelClass}>Title</label><input type="text" name="title" onChange={handleChange} className={commonInputClass} /></div><div><label htmlFor="content" className={commonLabelClass}>Content</label><textarea name="content" rows={5} onChange={handleChange} className={commonInputClass} /></div></>)}
            {type === 'event' && (<><div><label htmlFor="title" className={commonLabelClass}>Event Title</label><input type="text" name="title" onChange={handleChange} className={commonInputClass} /></div><div><label htmlFor="description" className={commonLabelClass}>Description</label><textarea name="description" rows={4} onChange={handleChange} className={commonInputClass} /></div><div><label htmlFor="eventDate" className={commonLabelClass}>Date & Time</label><input type="datetime-local" name="eventDate" onChange={handleChange} className={commonInputClass} /></div><div><label htmlFor="location" className={commonLabelClass}>Location</label><input type="text" name="location" onChange={handleChange} className={commonInputClass} /></div></>)}
            {type === 'achievement' && (<><div><label htmlFor="studentName" className={commonLabelClass}>Student Name(s)</label><input type="text" name="studentName" onChange={handleChange} className={commonInputClass} /></div><div><label htmlFor="description" className={commonLabelClass}>Description</label><textarea name="description" rows={4} onChange={handleChange} className={commonInputClass} /></div><div><label htmlFor="achievedDate" className={commonLabelClass}>Date Achieved</label><input type="date" name="achievedDate" onChange={handleChange} className={commonInputClass} /></div></>)}
            {formError && <Alert type="error" message={formError} />}
            <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={onClose} className="px-6 py-2.5 rounded-lg text-slate-300 bg-slate-600 hover:bg-slate-500 font-medium">Cancel</button>
                <button type="submit" className="px-6 py-2.5 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 font-semibold flex items-center"><Send size={18} className="mr-2"/>Post</button>
            </div>
        </form>
      </div>
    </div>
  );
};

const ProfileDropdown: React.FC = () => {
    const { userProfile } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    
    const handleLogout = async () => { if (auth) await signOut(auth); };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false); };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    if (!userProfile) return null;

    return (
        <div className="relative" ref={dropdownRef}>
            <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 p-1 rounded-full hover:bg-slate-700 transition-colors">
                <img src={userProfile.photoURL || `https://placehold.co/40x40/64748b/FFFFFF?text=${userProfile.displayName?.[0] || 'U'}`} alt="Profile" className="h-10 w-10 rounded-full"/>
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 origin-top-right bg-slate-800 border border-slate-700 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none animate-fadeIn">
                    <div className="py-1">
                        <div className="px-4 py-2 border-b border-slate-700"><p className="text-sm font-semibold text-white truncate">{userProfile.displayName}</p><p className="text-xs text-slate-400 truncate">{userProfile.email}</p></div>
                        <button onClick={handleLogout} className="w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-slate-700"><LogOut size={16}/> Logout</button>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- 7. GLOBAL ERROR BOUNDARY ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) { console.error("Uncaught error:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-4">
            <AlertTriangle className="h-16 w-16 text-red-500 mb-4"/><h1 className="text-2xl font-bold mb-2">Something went wrong.</h1><p className="text-slate-400">Please try refreshing the page.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- 8. AUTH PROVIDER COMPONENT ---
const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    useEffect(() => {
        if (!auth) { setIsAuthReady(true); return; }
        const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            setCurrentUser(user);
            if (!user) setUserProfile(null);
            setIsAuthReady(true);
        });
        return () => unsubscribeAuth();
    }, []);

    useEffect(() => {
        if (!db || !currentUser) { setUserProfile(null); return; }
        const profileDocRef = doc(db, `artifacts/${appId}/users/${currentUser.uid}/profile/data`);
        const unsubscribeProfile = onSnapshot(profileDocRef, (docSnap) => {
            if (docSnap.exists()) setUserProfile(docSnap.data() as UserProfile);
        });
        return () => unsubscribeProfile();
    }, [currentUser]);

    const value = { currentUser, userProfile, isAuthReady };
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// --- 9. MAIN APP COMPONENT ---
const App: React.FC = () => {
    const [currentView, setCurrentView] = useState<ViewType>('home');
    const { currentUser, userProfile, isAuthReady } = useAuth();
    const [modalState, setModalState] = useState<ModalState>({ isOpen: false, type: null });
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [events, setEvents] = useState<EventItem[]>([]);
    const [achievements, setAchievements] = useState<Achievement[]>([]);
    const [dataErrors, setDataErrors] = useState<Record<string, string | null>>({});

    useEffect(() => {
        if (!db || !isAuthReady || !userProfile) return;
        const publicDataPath = `artifacts/${appId}/public/data`;
        const dataMap: { [key in PostType]: React.Dispatch<React.SetStateAction<any[]>> } = {
            announcement: setAnnouncements,
            event: setEvents,
            achievement: setAchievements,
        };
        const unsubs = Object.entries(dataMap).map(([type, setter]) => {
            const q = query(collection(db!, `${publicDataPath}/${type}s`), orderBy('createdAt', 'desc'));
            return onSnapshot(q, snapshot => {
                setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setDataErrors(prev => ({...prev, [type]: null}));
            }, err => {
                console.error(`Error fetching ${type}s:`, err);
                setDataErrors(prev => ({...prev, [type]: `Could not load ${type}s. This is likely a permission issue with the database.`}))
            });
        });
        return () => unsubs.forEach(unsub => unsub());
    }, [isAuthReady, userProfile]);
    
    const handleCreatePost = async (formData: any) => {
      if (!db || !currentUser || !userProfile || !modalState.type) return;
      const dataToSave = { ...formData, authorId: currentUser.uid, authorName: userProfile.displayName, authorRole: userProfile.role, createdAt: serverTimestamp() };
      await addDoc(collection(db, `artifacts/${appId}/public/data/${modalState.type}s`), dataToSave);
      setModalState({ isOpen: false, type: null });
    };
    
    if (!isAuthReady) { return <Spinner size="lg" text="Initializing Platform..." />; }
    if (!currentUser) { return <AuthPage />; }
    if (userProfile && userProfile.status === 'pending') { return <PendingApprovalPage />; }
    
    const visibleNavItems = NAV_ITEMS.filter(item => !item.adminOnly || (userProfile && ['hod', 'admin'].includes(userProfile.role)));

    const renderContent = () => {
        if (!userProfile) return <Spinner size="lg" text="Loading Profile..." />;
        switch (currentView) {
            case 'home': return <HomePage />;
            case 'chat': return <ChatPage />;
            case 'announcement': return <ContentList type="announcement" items={announcements} error={dataErrors.announcement} title="Department Announcements" icon={<Bell className="h-8 w-8 text-indigo-400"/>} openModal={(type) => setModalState({ type, isOpen: true})} userProfile={userProfile} />;
            case 'event': return <ContentList type="event" items={events} error={dataErrors.event} title="Upcoming Events" icon={<CalendarDays className="h-8 w-8 text-teal-400"/>} openModal={(type) => setModalState({ type, isOpen: true})} userProfile={userProfile} />;
            case 'achievement': return <ContentList type="achievement" items={achievements} error={dataErrors.achievement} title="Student Achievements" icon={<Award className="h-8 w-8 text-amber-400"/>} openModal={(type) => setModalState({ type, isOpen: true})} userProfile={userProfile} />;
            case 'library': return <PlaceholderPage title="Digital Library" icon={<Library />} description="A structured repository for subject notes, past papers, teacher-shared materials, and student-contributed notes." />;
            case 'gallery': return <PlaceholderPage title="Department Gallery" icon={<ImageIcon />} description="Share and view photos from department events and student life with different privacy levels." />;
            case 'about': return <AboutPage />;
            case 'admin_panel': return <PlaceholderPage title="Admin Panel" icon={<ShieldCheck />} description="A dedicated panel for HODs and Admins to manage user approvals, roles, and platform content." />;
            default: return <Card><Alert type="error" message="Page not found."/></Card>;
        }
    };
    
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-gray-200 flex flex-col font-inter">
            <header className="bg-slate-900/80 backdrop-blur-md shadow-xl sticky top-0 z-50">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8"><div className="flex items-center justify-between h-20">
                    <div className="flex items-center"><Building2 className="h-10 w-10 text-indigo-400" /><span className="ml-3 text-3xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-500">RGU CSE Portal</span></div>
                    <nav className="hidden lg:flex space-x-2 items-center">
                        {visibleNavItems.map((item) => <button key={item.name} onClick={() => setCurrentView(item.view)} className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ease-in-out ${currentView === item.view ? 'bg-indigo-500 text-white shadow-md scale-105' : 'text-gray-300 hover:bg-slate-700 hover:text-white'}`}>{React.cloneElement(item.icon, { className: 'mr-2'})} {item.name}</button>)}
                    </nav>
                     <div className="flex items-center"><ProfileDropdown /></div>
                </div></div>
            </header>
            <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8">{renderContent()}</main>
            <footer className="bg-slate-900/80 backdrop-blur-md shadow-inner mt-auto"><div className="container mx-auto py-6 text-center text-gray-400 text-sm"><p>&copy; {new Date().getFullYear()} Abu Sufian Sarkar & CSE Department, RSET, The Assam Royal Global University. All rights reserved.</p></div></footer>
            <CreatePostModal type={modalState.type} isOpen={modalState.isOpen} onClose={() => setModalState({ isOpen: false, type: null })} onSubmit={handleCreatePost} userProfile={userProfile} />
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
                .font-inter { font-family: 'Inter', sans-serif; }
                @keyframes fadeInAnimation { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
                .animate-fadeIn { animation: fadeInAnimation 0.3s ease-out forwards; }
                @keyframes modalEnterAnimation { from { opacity: 0; transform: scale(0.95) translateY(-20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
                .animate-modalEnter { animation: modalEnterAnimation 0.3s cubic-bezier(0.165, 0.84, 0.44, 1) forwards; }
            `}</style>
        </div>
    );
};

// --- 10. ROOT COMPONENT ---
const ProductionApp = () => ( <ErrorBoundary> <AuthProvider> <App /> </AuthProvider> </ErrorBoundary> );
export default ProductionApp;
