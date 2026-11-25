import { base44 } from "@/api/base44Client";

// Camera frames stay private (stored privately). A short-lived link is passed
// alongside the storage reference, so the frame can be read by whichever
// scanner deployment is live.
export default async function scanFrameFile(file) {
  const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
  const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 300 });
  return { file_uri, file_url: signed_url };
}