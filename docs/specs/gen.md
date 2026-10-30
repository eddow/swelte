# Generates files

## `o.push`

This `o.push` invasion in vite.ts is a plague.

I just red a simple exemple: 
```
// Helper for cleaner inline loops via .map()
const list = (collection, fn) => collection.map(fn).join('');

// Usage:
const users = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }];

const markup = `
  <ul>
    ${list(users, item => `
      <li>Hello, ${item.name}</li>
    `)}
  </ul>
`;
```

This is not perfect, but I introduced the little `v` function
```
function v(ss: string[], ...values: unknown[]) {
	return ss.reduce((result, str, i) => {
		const v = values[i]
		return result + str + (Array.isArray(v) ? v.join('') : v ?? '');
	}, '');
}
```

We could use big templates and provide strings/arrays to the «v» template - it would among other things allow us to use crlf, tabs, single and double quotes without «\»

## server.v

For now, each app makes its own `/server.v`

A developer building an app with Swelte should **never** have to write, look at, or maintain this `serve.v` file.

This file is the runtime harness—the invisible glue that translates raw TCP/HTTP requests into Swelte’s data structures, handles CORS, serves static assets, and manages fallbacks. It is 100% the responsibility of `@swelte/core` to generate this file automatically behind the scenes during the build or dev step.

---

### How Swelte Should Handle This Under the Hood

When a developer runs `swelte build` or `swelte dev`, your core compiler should:

1. **Scan the Routes:** Read `src/routes/**/*.v` and `src/routes/**/*.svelte`.
2. **Generate the Router (`routes.v`):** Compile their specific data loaders and endpoints into `swelte_route()`.
3. **Emit the Server Harness (`serve.v`):** Dynamically write out (or embed) the exact code you pasted above into a hidden build directory (e.g., `.swelte/dist/server.v` or similar).
4. **Compile the Final Binary:** Invoke the V compiler on that generated harness to produce the single standalone executable.

Frameworks like Next.js, Remix, and Nuxt do this exact same thing—they generate complex Node.js server wrappers into a `.next/` or `.nuxt/` folder so the user doesn't have to touch them.

### What This Means for Your Architecture

Your design for `@swelte/core` should include a **Server Template** (or a code-generation module) that injects configuration variables (like the default port, CORS settings, and static asset directories) into this exact `serve.v` skeleton automatically.

The developer only writes their routes and components; Swelte provides the engine *and* the chassis!

## init

Indeed, most files (but which should be reviewed) are correctly created in the src folder by `swelte init` *but* some (like `server.v` should be generated/copied in `.swelte` or something)
Also, init could definitively copy files from an `init` folder and recursively-copy instead of hardcoding all the files in one source (if server.v is not generated, `build` could do the same with `.swelte`)