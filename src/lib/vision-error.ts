export function visionErrorMessage(error: string): string {
  if (/402|insufficient_quota|credits exhausted|billing|quota exceeded/i.test(error)) return "The image-reading service has reached its credit or billing limit. Your screenshot is still available for manual review.";
  if (/429|rate.limit|too many requests/i.test(error)) return "The image-reading service is busy. Wait a moment before scanning again; your screenshot has been kept.";
  if (/timeout|timed out|abort/i.test(error)) return "The image scan took too long. Your screenshot has been kept; try scanning it again.";
  if (/413|too large|image size|payload/i.test(error)) return "The image-reading service rejected this image's size. Your original screenshot has been kept.";
  if (/401|403|api.key|no ai key|unauthoriz|permission/i.test(error)) return "The image-reading service is unavailable with the app's current access settings. Your screenshot is still available for manual review.";
  if (/json|parse|structured/i.test(error)) return "The image-reading service returned an unreadable answer. No extracted fields were applied; your screenshot has been kept.";
  return "The image scan failed. Your screenshot has been kept; you can enter its details manually or try scanning again.";
}