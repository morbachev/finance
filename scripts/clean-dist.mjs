import {rm} from 'node:fs/promises';
// A clean build prevents removed JS/CSS from surviving in GitHub Pages artifacts.
await rm('dist',{recursive:true,force:true});
