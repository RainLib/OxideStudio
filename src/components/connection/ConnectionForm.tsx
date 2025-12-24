import { useConnectionStore, ConnectionConfig } from "@/store/useConnectionStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Save, Play } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

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

export function ConnectionForm() {
   const { selectedConnection, saveConnection, connect, updateConnectionConfig } = useConnectionStore();
   const [testStatus, setTestStatus] = useState<string | null>(null);

   if (!selectedConnection) {
       return <div className="flex-1 flex items-center justify-center text-muted-foreground">Select a connection to configure</div>
   }

   const handleChange = (field: keyof ConnectionConfig, value: any) => {
       updateConnectionConfig({ [field]: value });
   };

   const handleSave = async () => {
       if (selectedConnection) {
           await saveConnection(selectedConnection);
       }
   };

   const handleConnect = async () => {
       if (selectedConnection) {
           // Autosave before connect? Beekeeper usually does or asks. We will just connect for now.
           // Actually let's save first to be safe, or at least update local state which is already done.
           const error = await connect(selectedConnection);
           if (error) {
               setTestStatus("Error: " + error);
           }
       }
   };

   const handleTest = async () => {
       if (selectedConnection) {
            setTestStatus("Testing...");
            // Reuse connect logic but maybe add a flag for "test only" in backend later.
            // For now, we just connect.
            const error = await connect(selectedConnection);
            if (error) {
                setTestStatus("Connection Failed: " + error);
            } else {
                setTestStatus("Connection Successful!");
                // Disconnect immediately after test?
                // For now keep it simple.
            }
       }
   }

   return (
      <div className="flex-1 flex items-center justify-center p-8 bg-muted/10 h-full overflow-y-auto">
         <Card className="w-full max-w-2xl">
            <CardHeader>
                <CardTitle>{selectedConnection.name || "New Connection"}</CardTitle>
                <CardDescription>Configure {selectedConnection.driver} connection.</CardDescription>
            </CardHeader>
            <CardContent>
                <form className="grid gap-6">
                    <div className="grid grid-cols-2 gap-4">
                        <Button
                            type="button"
                            variant={selectedConnection.driver === 'postgres' ? 'default' : 'outline'}
                            onClick={() => handleChange('driver', 'postgres')}
                            className="w-full"
                        >
                            Postgres
                        </Button>
                        <Button
                            type="button"
                            variant={selectedConnection.driver === 'mysql' ? 'default' : 'outline'}
                            onClick={() => handleChange('driver', 'mysql')}
                            className="w-full"
                        >
                            MySQL
                        </Button>
                    </div>

                    <SimpleInput
                        label="Connection Name"
                        value={selectedConnection.name}
                        onChange={(e) => handleChange('name', e.target.value)}
                        placeholder="My Production DB"
                    />

                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                             <SimpleInput
                                label="Host"
                                value={selectedConnection.host || ""}
                                onChange={(e) => handleChange('host', e.target.value)}
                                placeholder="localhost"
                            />
                        </div>
                        <SimpleInput
                            label="Port"
                            type="number"
                            value={selectedConnection.port || ""}
                            onChange={(e) => handleChange('port', parseInt(e.target.value) || 5432)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                         <SimpleInput
                            label="User"
                            value={selectedConnection.user || ""}
                            onChange={(e) => handleChange('user', e.target.value)}
                        />
                         <SimpleInput
                            label="Password"
                            type="password"
                            value={selectedConnection.password || ""}
                            onChange={(e) => handleChange('password', e.target.value)}
                        />
                    </div>
                     <SimpleInput
                        label="Default Database"
                        value={selectedConnection.database || ""}
                        onChange={(e) => handleChange('database', e.target.value)}
                    />
                </form>

                {testStatus && (
                    <div className={cn("mt-4 p-3 rounded-md text-sm", testStatus.startsWith("Error") || testStatus.startsWith("Connection Failed") ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800")}>
                        {testStatus}
                    </div>
                )}
            </CardContent>
            <CardFooter className="flex justify-between bg-muted/20 p-6">
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={handleTest}>Test</Button>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={handleSave}>
                        <Save className="mr-2 h-4 w-4" /> Save
                    </Button>
                    <Button onClick={handleConnect}>
                        <Play className="mr-2 h-4 w-4" /> Connect
                    </Button>
                </div>
            </CardFooter>
         </Card>
      </div>
   );
}
