import { useEffect, useState } from "react";
import { useConnectionStore, ConnectionConfig } from "@/store/useConnectionStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Plus, Database, Monitor, Save, Play } from "lucide-react";


// Simple Input component to avoid dependency issues if shadcn input missing
function SimpleInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
    return (
        <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                {label}
            </label>
            <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                {...props}
            />
        </div>
    );
}

export function ConnectionPage() {
  const { connections, loadConnections, connect, addConnection, isLoading } = useConnectionStore();
  const [formData, setFormData] = useState<Omit<ConnectionConfig, "id">>({
    name: "New Connection",
    driver: "postgres",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "postgres",
    url: "",
  });

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await addConnection(formData);
  };

  const handleConnect = async () => {
     // Create a temporary config to connect without saving if desired,
     // or just connect to the one in the form:
     const res = await connect({ ...formData, id: "temp" });
     if (res) {
         alert("Connection failed: " + res);
     }
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      {/* Sidebar List */}
      <div className="w-64 border-r bg-muted/30 flex flex-col">
        <div className="p-4 border-b">
          <Button
            onClick={() => setFormData({
                name: "New Connection",
                driver: "postgres",
                host: "localhost",
                port: 5432,
                user: "postgres",
                password: "",
                database: "postgres",
                url: ""
            })}
            className="w-full gap-2" variant="outline"
          >
            <Plus size={16} /> New Connection
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
           {isLoading && <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>}
           {connections.map((conn) => (
             <div
                key={conn.id}
                className="flex items-center gap-3 p-3 rounded-md hover:bg-accent cursor-pointer group"
                onClick={() => setFormData(conn)}
             >
                {conn.driver === 'postgres' ? <Database size={18} className="text-blue-500" /> : <Monitor size={18} className="text-orange-500" />}
                <div className="flex-1 overflow-hidden">
                    <div className="font-medium truncate">{conn.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{conn.host}:{conn.port}</div>
                </div>
             </div>
           ))}
        </div>
      </div>

      {/* Main Content (Form) */}
      <div className="flex-1 flex items-center justify-center p-8 bg-muted/10">
         <Card className="w-[500px]">
            <CardHeader>
                <CardTitle>Connection Details</CardTitle>
                <CardDescription>Configure your database connection.</CardDescription>
            </CardHeader>
            <CardContent>
                <form className="grid gap-4">
                    <div className="grid grid-cols-2 gap-4">
                        <Button
                            type="button"
                            variant={formData.driver === 'postgres' ? 'default' : 'outline'}
                            onClick={() => setFormData({...formData, driver: 'postgres', port: 5432})}
                            className="w-full"
                        >
                            Postgres
                        </Button>
                        <Button
                            type="button"
                            variant={formData.driver === 'mysql' ? 'default' : 'outline'}
                            onClick={() => setFormData({...formData, driver: 'mysql', port: 3306})}
                            className="w-full"
                        >
                            MySQL
                        </Button>
                    </div>

                    <SimpleInput
                        label="Connection Name"
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                    />

                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                             <SimpleInput
                                label="Host"
                                value={formData.host}
                                onChange={(e) => setFormData({...formData, host: e.target.value})}
                            />
                        </div>
                        <SimpleInput
                            label="Port"
                            type="number"
                            value={formData.port}
                            onChange={(e) => setFormData({...formData, port: parseInt(e.target.value)})}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                         <SimpleInput
                            label="User"
                            value={formData.user}
                            onChange={(e) => setFormData({...formData, user: e.target.value})}
                        />
                         <SimpleInput
                            label="Password"
                            type="password"
                            value={formData.password}
                            onChange={(e) => setFormData({...formData, password: e.target.value})}
                        />
                    </div>
                     <SimpleInput
                        label="Database"
                        value={formData.database}
                        onChange={(e) => setFormData({...formData, database: e.target.value})}
                    />
                </form>
            </CardContent>
            <CardFooter className="flex justify-between">
                <Button variant="outline" onClick={handleSubmit}>
                    <Save className="mr-2 h-4 w-4" /> Save
                </Button>
                <Button onClick={handleConnect}>
                    <Play className="mr-2 h-4 w-4" /> Connect
                </Button>
            </CardFooter>
         </Card>
      </div>
    </div>
  );
}
