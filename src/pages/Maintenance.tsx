import { Database, ShieldCheck, Clock, Mail, Phone, Server, Lock } from "lucide-react";

const Maintenance = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/10 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute top-0 -left-40 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 -right-40 w-96 h-96 bg-accent/20 rounded-full blur-3xl" />
      </div>

      <div className="max-w-3xl w-full relative z-10">
        <div className="bg-card/80 backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-8 md:p-12 space-y-8">
          {/* Header Badge */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold uppercase tracking-wider">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              Scheduled System Maintenance
            </div>
          </div>

          {/* Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/30 rounded-2xl blur-2xl animate-pulse" />
              <div className="relative bg-gradient-to-br from-primary to-primary/70 rounded-2xl p-6 shadow-lg">
                <Database className="h-14 w-14 text-primary-foreground" />
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="text-center space-y-4">
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text">
              Data Migration in Progress
            </h1>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Our systems are temporarily offline while we perform a critical infrastructure
              upgrade and secure data migration. Service will resume automatically once the
              migration is successfully completed.
            </p>
          </div>

          {/* Reassurance card */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 text-center">
            <p className="text-sm md:text-base text-foreground leading-relaxed">
              <span className="font-semibold text-primary">TennaHub Technologies Limited</span> has
              you fully covered. All your data has been securely backed up, and the migration is
              expected to complete within <span className="font-semibold">24 hours</span>.
            </p>
          </div>

          {/* Status grid */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-background/50">
              <ShieldCheck className="h-6 w-6 text-primary" />
              <span className="text-xs font-semibold text-center">Data Secured</span>
              <span className="text-[11px] text-muted-foreground text-center">Encrypted backup verified</span>
            </div>
            <div className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-background/50">
              <Server className="h-6 w-6 text-primary" />
              <span className="text-xs font-semibold text-center">Migration Active</span>
              <span className="text-[11px] text-muted-foreground text-center">Transferring records</span>
            </div>
            <div className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-background/50">
              <Clock className="h-6 w-6 text-primary" />
              <span className="text-xs font-semibold text-center">ETA: 24 Hours</span>
              <span className="text-[11px] text-muted-foreground text-center">Auto-restore on completion</span>
            </div>
          </div>

          {/* Lock notice */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/40 border border-border">
            <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
              For data integrity, all access to the website and management system has been
              temporarily restricted during this maintenance window. We sincerely apologize for
              any inconvenience and appreciate your patience.
            </p>
          </div>

          {/* Contact */}
          <div className="border-t border-border pt-6 space-y-3">
            <p className="text-center text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              For urgent inquiries, please contact our support team
            </p>
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4 text-sm">
              <a href="mailto:support@tennahub.com" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                <Mail className="h-4 w-4" />
                support@tennahub.com
              </a>
              <span className="hidden sm:inline text-border">•</span>
              <a href="tel:+256700000000" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
                <Phone className="h-4 w-4" />
                +256 700 000 000
              </a>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center pt-2">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} TennaHub Technologies Limited — Powering reliable business systems
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Maintenance;
