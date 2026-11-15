export { loginCommand, type LoginFix } from "../google/login-command"

/** The command that makes a credential file private, as the message of the refusal names it. */
export function privateFileCommand(path: string): string {
  return `chmod 600 ${JSON.stringify(path)}`
}

/** What a person does about a credential held in a variable: `login` stores nothing while the variable is set. */
export function variableFix(variable: string): string {
  return `Replace the credential in ${variable} with a new one, or unset it to use the label's credential file; login stores nothing while it is set.`
}
