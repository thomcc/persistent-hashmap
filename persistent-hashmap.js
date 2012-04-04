
// taken from goog.string.hashCode
function ghash(str) {
  var result = 0;
  for (var i = 0; i < str.length; ++i) {
    result = 31*result+str.charCodeAt(i);
    result %= 0x100000000;
  }
  return result;
}

function equiv(a, b) {
  return a === b;
}

function mask(hash, shift) {
  return (hash >>> shift) & 0x01f;
}

function bitpos(hash, shift) {
  return 1 << mask(hash, shift);
}

function cloneAndSet(array, i, a) {
  var clone = array.slice(0);
  clone[i] = a;
  return clone;
}

function arraycopy(src, srcpos, dest, destpos, length) {
  for (var i = 0; i < length; ++i) {
    dest[i+destpos] = src[i+srcpos];
  }
}

function cloneAndSet2(array, i, a, j, b) {
  var clone = array.slice(0);
  clone[i] = a;
  clone[j] = b;
  return clone;
}

function removePair(array, i) {
  var j, k, l, newArray = new Array(array.length-2);
  arraycopy(array, 0, newArray, 0, 2*i);
  arraycopy(array, 2*(i+1), newArray, 2*i, newArray.length-2*i);
  return newArray;
}

function createNode(shift, key1, val1, key2hash, key2, val2) {
  var key1hash = ghash(key1);
  if (key1hash === key2hash) {
    return new HashCollisionNode(key1hash, 2, [key1, val1, key2, val2]);
  } else {
    var box = {val: null};
    return BitmapIndexedNode.EMPTY.assoc(shift, key1hash, key1, val2, box)
                                  .assoc(shift, key2hash, key2, val2, box);
  }
}
// much less efficient than Integer.bitCount
function bitCount(i) {
  i = i - ((i >>> 1) & 0x55555555);
  i = (i & 0x33333333) + ((i >>> 2) & 0x33333333);
  return (((i + (i >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

function HashCollisionNode(hash, count, array) {
  this.hash = hash;
  this.count = count;
  this.array = array;
}

HashCollisionNode.prototype = {
  assoc: function(shift, hash, key, val, addedLeaf) {
    if (hash === this.hash) {
      var idx = this.findIndex(key);
      if (idx != -1) {
        if (this.array[idx+1] === val) {
          return this;
        } else {
          return new HashCollisionNode(hash, this.count, cloneAndSet(this.array, idx+1, val));
        }
      }
      var newArray = new Array(this.array.length+2);
      arraycopy(this.array, 0, newArray, 0, this.array.length);
      newArray[this.array.length] = key;
      newArray[this.array.length+1] = val;
      addedLeaf.val = addedLeaf;
      return new HashCollisionNode(hash, this.count+1, newArray);
    } else {
      return new BitmapIndexedNode(bitpos(this.hash, shift), [null, this]).assoc(shift, hash, key, val, addedLeaf);
    }
  },
  without: function(shift, hash, key) {
    var idx = this.findIndex(key);
    if (idx < 0) {
      return this;
    } else if (this.count === 1) {
      return null;
    } else {
      return new HashCollisionNode(hash, this.count-1, removePair(this.array, idx/2));
    }
  },
  find: function(shift, hash, key, notFound) {
    var idx = this.findIndex(key);
    if (idx < 0) {
      return notFound;
    } else if (equiv(key, this.array[idx])) {
      return this.array[idx+1];
    } else {
      return notFound;
    }
  },
  findIndex: function(key) {
    for (var i = 0; i < 2*this.count; i+= 2) {
      if (equiv(key, this.array[i])) {
        return i;
      }
    }
    return -1;
  }
};

function ArrayNode(count, array) {
  this.count = count;
  this.array = array;
}

ArrayNode.prototype = {
  assoc: function(shift, hash, key, val, addedLeaf) {
    var idx = mask(hash, shift);
    var node = this.array[idx];
    if (node == null)
      return new ArrayNode(this.count+1, cloneAndSet(this.array, idx, BitmapIndexedNode.EMPTY.assoc(shift+5, hash, key, val, addedLeaf)));
    var n = node.assoc(shift+5, hash, key, val, addedLeaf);
    if (n === node) return this;
    return new ArrayNode(this.count, cloneAndSet(this.array, idx, n));
  },
  without: function(shift, hash, key) {
    var idx = mask(hash, shift);
    var node = this.array[idx];
    if (node === null) {
      return this;
    } else {
      var n = node.without(shift+5, hash, key);
      if (n === node) {
        return this;
      } else if (n === null) {
        if (this.count <= 8) {
          return this.pack(idx);
        } else {
          return new ArrayNode(this.count-1, cloneAndSet(this.array, idx, n));
        }
      } else {
        return new ArrayNode(this.count, cloneAndSet(this.array, idx, n));
      }
    }
  },
  find: function(shift, hash, key, notFound) {
    var idx = mask(hash, shift);
    var node = this.array[idx];
    if (node === null) {
      return notFound;
    } else {
      return node.find(shift+5, hash, key, notFound);
    }
  },
  pack: function(idx) {
    var newArray = new Array(2 * (this.count-1));
    var j = 1;
    var bitmap = 0;
    for (var i = 0; i < idx; ++i) {
      if (this.array[i] != null) {
        newArray[j] = this.array[i];
        bitmap |= 1 << i;
        j += 2;
      }
    }
    for (i = idx+1; i < this.array.length; ++i) {
      if (this.array[i] != null) {
        newArray[j] = this.array[i];
        bitmap |= 1 << i;
        j += 2;
      }
    }
    return new BitmapIndexedNode(bitmap, newArray);
  }
};

function BitmapIndexedNode(bitmap, array) {
  this.bitmap = bitmap;
  this.array = array;
}

BitmapIndexedNode.prototype = {
  index: function(bit) {
    return bitCount(this.bitmap & (bit-1));
  },
  assoc: function(shift, hash, key, val, addedLeaf) {
    var bit = bitpos(hash, shift);
    var idx = this.index(bit);
    if ((this.bitmap & bit) !== 0) {
      var keyOrNull = this.array[2*idx];
      var valOrNode = this.array[2*idx+1];
      if (keyOrNull === null) {
        var n = valOrNode.assoc(shift+5, hash, key, val, addedLeaf);
        if (n === valOrNode) return this;
        else return new BitmapIndexedNode(this.bitmap, cloneAndSet(this.array, 2*idx+1, n));
      }
      if (equiv(key, keyOrNull)) {
        if (val === valOrNode) return this;
        else return new BitmapIndexedNode(this.bitmap, cloneAndSet(this.array, 2*idx+1, val));
      }
      addedLeaf.val = addedLeaf;
      return new BitmapIndexedNode(this.bitmap, cloneAndSet2(
        this.array, 2*idx, null, 2*idx+1, createNode(shift+5, keyOrNull, valOrNode, hash, key, val)));
    } else {
      n = bitCount(this.bitmap);
      if (n >= 16) {
        var nodes = new Array(32);
        var jdx = mask(hash, shift);
        nodes[jdx] = BitmapIndexedNode.EMPTY.assoc(shift+5, hash, key, val, addedLeaf);
        var j = 0;
        for (var i = 0; i < 32; ++i) {
          if (((this.bitmap >>> i) & 1) !== 0) {
            if (this.array[j] == null) 
              nodes[i] = this.array[j+1];
            else 
              nodes[i] = BitmapIndexedNode.EMPTY.assoc(shift + 5, ghash(this.array[j]),
                                                       this.array[j], this.array[j+1], addedLeaf);
            j += 2;
          }
        }
        return new ArrayNode(n+1, nodes);
      } else {
        var newArray = new Array(2*(n+1));
        arraycopy(this.array, 0, newArray, 0, 2*idx);
        newArray[2*idx] = key;
        addedLeaf.val = addedLeaf;
        newArray[2*idx+1] = val;
        arraycopy(this.array, 2*idx, newArray, 2*(idx+1), 2*(n-idx));
        return new BitmapIndexedNode(this.bitmap | bit, newArray);
      }
    }
  },
  without: function(shift, hash, key) {
    var bit = bitpos(hash, shift);
    if ((this.bitmap & bit) === 0) {
      return this;
    } else {
      var idx = this.index(bit);
      var keyOrNull = this.array[2*idx];
      var valOrNode = this.array[2*idx+1];
      if (keyOrNull === null) {
        var n = valOrNode.without(shift+5, hash, key);
        if (n === valOrNode) {
          return this;
        } else if (n !== null) {
          return new BitmapIndexedNode(this.bitmap, cloneAndSet(this.array, 2*idx+1, n));
        } else if (this.bitmap === bit) {
          return null;
        } else {
          return new BitmapIndexedNode(this.bitmap ^ bit, removePair(this.array, idx));
        }
      } else if (equiv(key, keyOrNull)) {
        return new BitmapIndexedNode(this.bitmap ^ bit, removePair(this.array, idx));
      } else {
        return this;
      }
    }
  },
  find: function(shift, hash, key, notFound) {
    var bit = bitpos(hash, shift);
    if ((this.bitmap & bit) === 0) {
      return notFound;
    } else {
      var idx = this.index(bit);
      var keyOrNull = this.array[2*idx];
      var valOrNode = this.array[2*idx+1];
      if (keyOrNull === null) {
        return valOrNode.find(shift+5, hash, key, notFound);
      } else if (equiv(key, keyOrNull)) {
        return valOrNode;
      } else {
        return notFound;
      }
    }
  }
  
};
BitmapIndexedNode.EMPTY = new BitmapIndexedNode(0, []);

function PersistentHashMap(count, root, hasNull, nullValue) {
  this.count = count;
  this.root = root;
  this.hasNull = hasNull;
  this.nullValue = nullValue;
}

var NOT_FOUND = {};

PersistentHashMap.prototype = {

  containsKey: function(key) {
    if (key === null) {
      return this.hasNull;
    } else if (this.root !== null) {
      return this.root.find(0, ghash(key), key, NOT_FOUND);
    } else {
      return false;
    }
  },

  assoc: function(key, val) {
    if (key === null) {
      if (this.hasNull && val === this.nullValue) return this;
      else return new PersistentHashMap(this.hasNull ? this.count : this.count+1, this.root, true, val);
    }

    var addedLeaf = {val: null};
    var newroot = (this.root == null ? BitmapIndexedNode.EMPTY : this.root).assoc(0, ghash(key), key, val, addedLeaf);

    if (newroot === this.root) return this;
    else return new PersistentHashMap(addedLeaf.val === null ? this.count : this.count + 1, newroot, this.hasNull, this.nullValue);
  },

  valAt: function(key, notFound) {
    if (key === null) {
      return this.hasNull ? this.nullValue : notFound;
    } else {
      return this.root !== null ? this.root.find(0, ghash(key), key, notFound) : notFound;
    }
  },

  without: function(key) {
    if (key === null) {
      return this.hasNull ? new PersistentHashMap(this.count - 1, this.root, false, null) : this;
    } else if (this.root === null) {
      return this;
    } else {
      var newroot = this.root.without(0, ghash(key), key);
      if (newroot === this.root) {
        return this;
      } else {
        return new PersistentHashMap(this.count - 1, newroot, this.hasNull, this.nullValue);
      }
    }
  }
};


PersistentHashMap.EMPTY = new PersistentHashMap(0, null, false, null);

/*
var p = PersistentHashMap.EMPTY.assoc("foo", 30);


for (var i = 0; i < 1000; ++i) {
  var n = i.toString();
  var b = p.assoc(n, i);
  console.log(b);
  console.log(b.valAt(n));
  p = b;
}
*/






function time(f) {
  var start = new Date();
  f();
  console.log((new Date())-start);
}

//console.log("Instantiation: 1000000 iterations");
time(function() {
  for (var i = 0; i < 1000000; ++i) {
    new PersistentHashMap(0, null, false, null);    
  }
});

var m = PersistentHashMap.EMPTY;
time(function() {
  for (var i = 0; i < 1000000; ++i) {
    m = m.assoc(""+i, i);
  }
  for (i = 0; i < 1000000; ++i) {
    m.valAt("999999");
  }
});

time(function() {
  for(var i = 0; i < 1000000; i++) {
    m.valAt("999999");
  }
});

var o = {};

time(function() {
  for (var i = 0; i < 1000000; ++i) {
    o[""+i] = i;
  }
});

time(function() {
  for (var i = 0; i < 1000000; ++i) {
    o["999999"];
  }
});
/*
for (var i = 0; i < 1000; ++i) {
  var n = i.toString();
  var b = p.assoc(n, i);
  console.log(b);
  console.log(b.valAt(n));
  p = b;
}
*/


