// Test rakibi: sıraya girer, seçim yapar, tahmin yapmaz.
// Kullanım: node scripts/bot.mjs [cc|nc]   (cc = Kulüp-Kulüp, nc = Ülke-Kulüp)
import { io } from 'socket.io-client';
const mode = process.argv[2] === 'nc' ? 'nc' : 'cc';
const s = io(process.env.URL || 'http://localhost:3000');
s.on('connect', () => s.emit('auth', { guestId: 'e2e-bot', name: 'TestBot' }, () => s.emit('queue:join', { mode })));
// Kulüp seçerse Real Madrid, ülke seçerse Brezilya
s.on('round:pick', ({ role }) => setTimeout(() => s.emit('pick', { id: role === 'country' ? 'Q155' : 'Q8682' }, () => {}), 2000));
s.on('match:end', () => process.exit(0));
