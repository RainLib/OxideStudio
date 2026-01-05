import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface LspBinaryInfo {
  version: string;
  path: string;
  exists: boolean;
  downloadUrl?: string;
}

export function LspBinaryManager() {
  const [binaryInfo, setBinaryInfo] = useState<LspBinaryInfo | null>(null);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  useEffect(() => {
    checkBinary();
  }, []);

  async function checkBinary() {
    try {
      const info = await invoke<LspBinaryInfo>("check_lsp_binary");
      setBinaryInfo(info);

      // Show download dialog if binary doesn't exist
      if (!info.exists) {
        setShowDownloadDialog(true);
      }
    } catch (error) {
      console.error("Failed to check LSP binary:", error);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    setDownloadSuccess(false);

    try {
      const result = await invoke<string>("download_lsp_binary");
      console.log("Download result:", result);
      setDownloadSuccess(true);

      // Re-check binary status
      await checkBinary();

      // Close dialog after 2 seconds
      setTimeout(() => {
        setShowDownloadDialog(false);
        setDownloadSuccess(false);
      }, 2000);
    } catch (error) {
      console.error("Download failed:", error);
      setDownloadError(error as string);
    } finally {
      setDownloading(false);
    }
  }

  function handleDismiss() {
    setShowDownloadDialog(false);
  }

  if (!binaryInfo || binaryInfo.exists) {
    return null;
  }

  return (
    <Dialog open={showDownloadDialog} onOpenChange={setShowDownloadDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            LSP Binary Required
          </DialogTitle>
          <DialogDescription>
            The SQL Language Server binary is required for advanced SQL features
            like intelligent autocomplete and syntax checking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {downloadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{downloadError}</AlertDescription>
            </Alert>
          )}

          {downloadSuccess && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertDescription className="text-green-600 dark:text-green-400">
                Download completed successfully!
              </AlertDescription>
            </Alert>
          )}

          <div className="bg-muted p-4 rounded-md text-sm">
            <p className="font-medium mb-2">What will happen:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Download (~5MB) from GitHub releases</li>
              <li>Extract sql-lsp binary (v{binaryInfo.version})</li>
              <li>Enable LSP features automatically</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={handleDismiss}
            disabled={downloading}
          >
            Later
          </Button>
          <Button
            onClick={handleDownload}
            disabled={downloading || downloadSuccess}
          >
            {downloading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {downloading ? "Downloading..." : "Download Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
