import { Collection } from "../api.js"
import { ArrayColl } from "../collection/array.js"
import { assert } from "../util.js"

Collection.prototype.filterOnce = function (filterFunc) {
  let filteredColl = new ArrayColl();
  filteredColl.addAll(this.contents.filter(item => filterFunc(item)));
  return filteredColl;
}

/**
 * Returns a subset of the source collection.
 * Which items will be included is defined by `filterFunc`.
 * This works like `Array.filter()`.
 *
 * It's observable, i.e. if the source collection changed and `filterFunc` matches,
 * items will be added and the observers called.
 *
 * It's also observing. It will observe all items.
 * If their properties change and the item now matches or
 * nor longer matches, it will be added to or removed from the filtered result.
 *
 * Implementation note:
 * This works only 1 level deep, i.e. only direct properties of the added items
 * are observed, not when the item references another item and the
 * condition depends on that. This limitation should be lifted some time, so
 * don't depend on this *not* working, either.
 *
 * @param filterFunc {Function(item)}
 *     `item` will be included in FilteredCollection, (only) if `true` is returned
 */
Collection.prototype.filterObservable = function (filterFunc) {
  return new ObservableFilteredCollection(this, filterFunc);
}

/**
 * Returns a subset of the source collection.
 * Which items will be included is defined by `filterFunc`.
 * This works like `Array.filter()`.
 *
 * It's writable, i.e. you can add and remove items from the filtered collection.
 * The changes will be reflected in the source collection.
 * 
 * However, any items added before this filter was applied will not be removed
 * from the source collection, even if they don't match the filter condition.
 * Unless there was an update to the item, then it will be removed if it doesn't match anymore.
 *
 * @param filterFunc {Function(item)}
 *     `item` will be included in FilteredCollection, (only) if `true` is returned
 */
Collection.prototype.filterWritable = function (filterFunc) {
  return new WritableFilteredCollection(this, filterFunc);
}

/**
 * Returns a subset of the source collection.
 * Which items will be included is defined by `filterFunc`.
 * This works like `Array.filter()`.
 *
 * It's observable, i.e. if the source collection changed and `filterFunc` matches,
 * items will be added and the observers called.
 *
 * @deprecated
 * However, if any of the items change their properties and are now
 * matching or not matching anymore, the result will *not* change.
 *
 * @param filterFunc {Function(item)}
 *     `item` will be included in FilteredCollection, (only) if `true` is returned
 */
Collection.prototype.filter = function (filterFunc) {
  return new ShallowFilteredCollection(this, filterFunc);
}



/**
 * Returns a subset of the source collection.
 * Which items will be included is defined by `filterFunc`.
 * This works like `Array.filter()`.
 *
 * It's observable, i.e. if the source collection changed and `filterFunc` matches,
 * items will be added and the observers called.
 *
 * @deprecated
 * However, if any of the items change their properties and are now
 * matching or not matching anymore, the result will *not* change.
 *
 * @param source {Collection}   Another collection that is to be filtered
 * @param filterFunc {Function(item)}
 *     `item` will be included in FilteredCollection, (only) if `true` is returned
 */
export class ShallowFilteredCollection extends ArrayColl {
  _observer = null;
  constructor(source, filterFunc) {
    super();
    assert(typeof (filterFunc) == "function", "must be a function");
    assert(source instanceof Collection, "must be a Collection");
    //this._source = source;
    this._filterFunc = filterFunc;

    // add initial contents
    for (let item of source) {
      if (filterFunc(item)) {
        this._addWithoutObserver(item);
      }
    }

    this._observer = new ShallowFilteredCollectionObserver(this);
    source.registerObserver(this._observer);
  }
}

class ShallowFilteredCollectionObserver { // implements CollectionObserver
  constructor(filteredColl) {
    this.filteredColl = filteredColl;
  }

  added(items) {
    this.filteredColl.addAll(items.filter(item => this.filteredColl._filterFunc(item)));
  }

  removed(items, coll) {
    this.filteredColl.removeAll(items);
  }
}
export const FilteredCollection = ShallowFilteredCollection;


/**
 * Returns a subset of the source collection.
 * Which items will be included is defined by `filterFunc`.
 * This works like `Array.filter()`.
 *
 * It's observable, i.e. if the source collection changed and `filterFunc` matches,
 * items will be added and the observers called.
 *
 * It's also observing. It will observe all items.
 * If their properties change and the item now matches or
 * nor longer matches, it will be added to or removed from the filtered result.
 *
 * Implementation note:
 * This works only 1 level deep, i.e. only direct properties of the added items
 * are observed, not when the item references another item and the
 * condition depends on that. This limitation should be lifted some time, so
 * don't depend on this *not* working, either.
 *
 * @param source {Collection}   Another collection that is to be filtered
 * @param filterFunc {Function(item)}
 *     `item` will be included in FilteredCollection, (only) if `true` is returned
 */
export class ObservableFilteredCollection extends ArrayColl {
  _observer = null;
  constructor(source, filterFunc) {
    super();
    assert(typeof (filterFunc) == "function", "must be a function");
    assert(source instanceof Collection, "must be a Collection");
    //this._source = source;
    this._filterFunc = filterFunc;

    this._observer = new ObservableFilteredCollectionObserver(this);
    source.registerObserver(this._observer);

    // add initial contents
    let sourceArray = source instanceof Collection
      ? source = source.contents
      : source;
    this._observer.added(sourceArray);
  }

  // TODO when last observer of filtered collection unsubscribes,
  // also unsubscribe the item observers
}

class ObservableFilteredCollectionObserver { // implements CollectionObserver
  constructor(filteredColl) {
    this.filteredColl = filteredColl;
    this.itemObservers = new Map();
  }

  added(items) {
    this.filteredColl.addAll(items.filter(item => this.filteredColl._filterFunc(item)));

    // Observe items, in case their properties change
    // and with that their inclusion validity
    if (typeof (items[0]?.subscribe) == "function") {
      let initial = true;
      for (let item of items) {
        let unsubscribe = item.subscribe(() => {
          if (initial) {
            return;
          }
          let match = this.filteredColl._filterFunc(item);
          if (match) {
            if (!this.filteredColl.contains(item)) {
              this.filteredColl.add(item);
            }
          } else {
            if (this.filteredColl.contains(item)) {
              this.filteredColl.remove(item);
            }
          }
        });
        this.itemObservers.set(item, unsubscribe);
      }
      initial = false;
    }
  }

  removed(items, coll) {
    this.filteredColl.removeAll(items);

    // Remove observer of item properties
    for (let item of items) {
      let unsubscribe = this.itemObservers.get(item);
      if (unsubscribe) {
        unsubscribe();
      }
    }
  }
}

/**
 * Returns a subset of the source collection.
 * Which items will be included is defined by `filterFunc`.
 * This works like `Array.filter()`.
 *
 * It's writable, i.e. you can add and remove items from the filtered collection.
 * The changes will be reflected in the source collection.
 * 
 * However, any items added before this filter was applied will not be removed
 * from the source collection, even if they don't match the filter condition.
 * Unless there was an update to the item, then it will be removed if it doesn't match anymore.
 *
 * @param source {Collection}   Another collection that is to be filtered
 * @param filterFunc {Function(item)}
 *     `item` will be included in FilteredCollection, (only) if `true` is returned
 */
export class WritableFilteredCollection extends ObservableFilteredCollection {
  constructor(source, filterFunc) {
    super(source, filterFunc);
    this._source = source;
  }

  add(item) {
    if (this._filterFunc(item)) {
      if (this._source.contains(item)) {
        super.add(item);
      } else {
        this._source.add(item);
      }
    }
  }

  remove(item) {
    this._source.remove(item);
  }
}
