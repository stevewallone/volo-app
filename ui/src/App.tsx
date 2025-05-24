import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ThemeProvider } from "@/components/theme-provider";
import { LoginForm } from '@/components/login-form';
import { Navbar } from '@/components/navbar';
import { AppSidebar } from '@/components/Sidebar';
import { api } from '@/lib/serverComm';
import { useEffect, useState } from 'react';
import {
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";



function AppContent() {
  const { user, loading } = useAuth();
  const [serverUserInfo, setServerUserInfo] = useState(null);
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    async function fetchUserInfo() {
      if (user) {
        try {
          const data = await api.getCurrentUser();
          setServerUserInfo(data);
          setServerError('');
        } catch (error) {
          setServerError('Failed to fetch user info from server');
          console.error('Server error:', error);
        }
      }
    }
    fetchUserInfo();
  }, [user]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"></div>;
  }

  return (
    <SidebarProvider>
      <div className="flex flex-col w-full min-h-screen bg-background">
        <Navbar />
        {!user ? (
          <main className="flex flex-col items-center justify-center flex-1 p-4">
            <LoginForm />
          </main>
        ) : (
          <div className="flex flex-1">
            <AppSidebar />
            <SidebarInset className="flex-1">
              <main className="flex flex-col items-center justify-center flex-1 p-4">
                <div className="space-y-4 text-center">
                  <h1 className="text-3xl font-bold">Your app will go here!</h1>
                  {serverError ? (
                    <p className="text-red-500">{serverError}</p>
                  ) : serverUserInfo ? (
                    <div className="p-4 border rounded-lg">
                      <h2 className="text-xl font-semibold mb-2">Server User Info</h2>
                      <pre className="text-left bg-muted p-2 rounded">
                        {JSON.stringify(serverUserInfo, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <p>Loading server info...</p>
                  )}
                </div>
              </main>
            </SidebarInset>
          </div>
        )}
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AppContent />
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
