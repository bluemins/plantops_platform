// pnpm backup:keygen - makes the key pair for encrypted backups (docs/HANDBOOK.md "Backups").
// Prints both keys on this screen only; nothing is written to disk.
import { generateX25519Identity, identityToRecipient } from "age-encryption";

const identity = await generateX25519Identity();
const recipient = await identityToRecipient(identity);
console.log(`
PRIVATE key (opens the backups). Save it in your password manager as "PlantOps backup key", then clear this screen.
Never put it in Railway, GitHub, a file in the repo, or a chat:

  ${identity}

PUBLIC key (only locks). Put it in GitHub (variable BACKUP_RECIPIENT) and in each Railway service that stores files:

  ${recipient}

Without the private key the backups can't be opened by anyone - including you. Keep two copies of it.
`);
