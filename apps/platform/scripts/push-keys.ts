// Makes a new Web Push key pair for phone notifications. Usage: pnpm push:keys
// Put all three lines in the platform's environment (Railway variables / .env.local). Keep the private key secret;
// every Dedicated copy gets its own pair. Changing the pair means every phone must tap "Turn on" again.
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:contact@bluemins.life");
