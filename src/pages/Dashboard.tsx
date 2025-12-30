import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ConfigDialog from "@/components/ConfigDialog";
import SavedListsManager from "@/components/SavedListsManager";
import GroupSender from "@/components/GroupSender";
import IndividualSender from "@/components/IndividualSender";

export default function Dashboard() {
  const [hasConfig, setHasConfig] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  useEffect(() => {
    checkConfig();
  }, []);

  const checkConfig = async () => {
    const { data } = await supabase
      .from('evolution_config')
      .select('*')
      .single();

    setHasConfig(!!data);
    if (!data) {
      setIsConfigOpen(true);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logout realizado!");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            WhatsApp Sender
          </h1>
          <div className="flex gap-2">
            <SavedListsManager />

            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsConfigOpen(true)}
              title="Configurações"
            >
              <Settings className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={handleLogout}
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="individual" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-8">
            <TabsTrigger value="individual" className="gap-2">
              <Send className="h-4 w-4" />
              Envio Individual
            </TabsTrigger>
            <TabsTrigger value="groups" className="gap-2">
              <Users className="h-4 w-4" />
              Envio para Grupos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="individual">
            <IndividualSender />
          </TabsContent>

          <TabsContent value="groups">
            <GroupSender />
          </TabsContent>
        </Tabs>
      </main>

      <ConfigDialog
        open={isConfigOpen}
        onOpenChange={setIsConfigOpen}
        onSaved={() => {
          setHasConfig(true);
          checkConfig();
        }}
      />
    </div>
  );
}
