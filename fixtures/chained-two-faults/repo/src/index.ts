import { loadGreeting, type Environment } from './config.js';

export function greet(env: Environment, name: string): string {
  return `${loadGreeting(env)} ${name}`;
}

export { DEFAULT_GREETING } from './config.js';
