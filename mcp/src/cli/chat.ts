import * as readline from 'readline';

const BASE_URL = process.env.CEDA_URL || process.env.HERALD_API_URL || 'https://getceda.com';

export async function runChat(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  console.log('\nHerald Pattern Journal\n');
  console.log('Commands:');
  console.log('  /learned <insight>  - capture what worked');
  console.log('  /stuck <insight>    - capture what failed');
  console.log('  /recall [topic]     - see your patterns');
  console.log('  /quit               - exit\n');
  
  const prompt = (): void => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }
      
      const [cmd, ...args] = trimmed.split(' ');
      const text = args.join(' ');
      
      if (cmd === '/learned' && text) {
        try {
          await fetch(`${BASE_URL}/api/herald/reflect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feeling: 'success', insight: text, session: 'chat' })
          });
          console.log('Pattern captured\n');
        } catch {
          console.log('Failed to capture pattern\n');
        }
      } else if (cmd === '/stuck' && text) {
        try {
          await fetch(`${BASE_URL}/api/herald/reflect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feeling: 'stuck', insight: text, session: 'chat' })
          });
          console.log('Antipattern captured\n');
        } catch {
          console.log('Failed to capture antipattern\n');
        }
      } else if (cmd === '/recall') {
        try {
          const url = text 
            ? `${BASE_URL}/api/herald/reflections?limit=10&topic=${encodeURIComponent(text)}`
            : `${BASE_URL}/api/herald/reflections?limit=10`;
          const res = await fetch(url);
          const data = await res.json() as { patterns?: Array<{ insight: string }>; antipatterns?: Array<{ insight: string }> };
          
          const patterns = data.patterns || [];
          const antipatterns = data.antipatterns || [];
          
          if (patterns.length > 0) {
            console.log('Patterns:');
            patterns.forEach(p => console.log(`  - ${p.insight}`));
          } else {
            console.log('Patterns: (none)');
          }
          
          if (antipatterns.length > 0) {
            console.log('Antipatterns:');
            antipatterns.forEach(p => console.log(`  - ${p.insight}`));
          } else {
            console.log('Antipatterns: (none)');
          }
          console.log('');
        } catch {
          console.log('Failed to recall patterns\n');
        }
      } else if (cmd === '/quit') {
        console.log('Bye! Your patterns are saved.');
        rl.close();
        return;
      } else if (cmd === '/learned' || cmd === '/stuck') {
        console.log(`Usage: ${cmd} <insight>\n`);
      } else {
        console.log('Commands: /learned <text>, /stuck <text>, /recall [topic], /quit\n');
      }
      prompt();
    });
  };
  prompt();
}
