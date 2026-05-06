import { Database, ShieldCheck, Clock } from "lucide-react";

const Maintenance = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full text-center space-y-8">
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-pulse" />
            <div className="relative bg-primary/10 border border-primary/30 rounded-full p-6">
              <Database className="h-16 w-16 text-primary" />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Data Migration in Progress
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">TennaHub Technologies Limited</span> will get you covered.
            Your data has been backed up safely, and this process will take up to a day.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 pt-4">
          <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card/50 backdrop-blur">
            <ShieldCheck className="h-6 w-6 text-primary shrink-0" />
            <span className="text-sm font-medium text-left">Your data is safe & fully backed up</span>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card/50 backdrop-blur">
            <Clock className="h-6 w-6 text-primary shrink-0" />
            <span className="text-sm font-medium text-left">Estimated completion: within 24 hours</span>
          </div>
        </div>

        <p className="text-sm text-muted-foreground pt-6">
          We appreciate your patience. — TennaHub Technologies Limited
        </p>
      </div>
    </div>
  );
};

export default Maintenance;
