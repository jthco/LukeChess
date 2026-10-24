# Garbochess-JS

Source: https://github.com/glinscott/Garbochess-JS/blob/4ff0f9e49a0041545b645e25d3d2da7af3b36a90/js/garbochess.js

Copyright 2011 Gary Linscott. BSD 3-Clause licence: see LICENSE.

LukeChess modification: the null-move/razoring block in AllCutNode is disabled
with a constant false guard. This prevents artificial skipped-turn variations.
Search instrumentation is in ../../explorer-worker.js rather than this file.
