import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { Product, CartItem, CategoryId, Currency, TelegramWebAppUser } from '../types';
import { getTelegramInitData, getTelegramUser, initTelegramApp, triggerHaptic } from '../utils/telegram';
import { API_BASE_URL, apiUrl } from '../utils/api';
import {
  CartLine,
  MAX_ITEMS_PER_LEAD,
  MAX_QUANTITY_PER_ITEM,
  cartSignature,
  parseStoredCart,
  parseStoredFavorites,
  upsertLine
} from '../utils/cartStorage';
import { LeadFormValues, LeadReceipt, LeadSubmitError, createIdempotencyKey, postLead } from '../utils/leadApi';
import { normalizeUzPhone } from '../utils/phone';

interface ShopContextType {
  products: Product[];
  /** True once the first catalog request finished, successfully or not. */
  catalogStatus: 'loading' | 'ready' | 'error';
  /** Cart lines joined with the live catalog (names, images and prices are never stored). */
  cart: CartItem[];
  favorites: Product[];
  favoriteIds: string[];
  selectedCategory: CategoryId | 'all';
  selectedBrand: string | 'all';
  searchQuery: string;
  sortBy: 'popular' | 'price-asc' | 'price-desc' | 'rating';
  currency: Currency;
  selectedProductForDetail: Product | null;
  isCartOpen: boolean;
  isLeadFormOpen: boolean;
  isFavoritesOpen: boolean;
  isTelegramFrame: boolean;
  isShareOpen: boolean;
  telegramUser: TelegramWebAppUser | null;
  toast: { message: string; type: 'success' | 'info' | 'error' } | null;

  // Actions
  setSelectedCategory: (cat: CategoryId | 'all') => void;
  setSelectedBrand: (brand: string | 'all') => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (sort: 'popular' | 'price-asc' | 'price-desc' | 'rating') => void;
  setCurrency: (curr: Currency) => void;
  setIsCartOpen: (open: boolean) => void;
  setIsLeadFormOpen: (open: boolean) => void;
  setIsFavoritesOpen: (open: boolean) => void;
  setIsTelegramFrame: (frame: boolean) => void;
  setIsShareOpen: (open: boolean) => void;
  reloadCatalog: () => Promise<void>;

  openProductDetail: (product: Product) => void;
  closeProductDetail: () => void;

  addToCart: (product: Product, quantity?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;

  toggleFavorite: (productId: string) => void;
  /** Sends the cart as a lead. Clears the cart only after the server accepted it; throws LeadSubmitError otherwise. */
  submitLead: (values: LeadFormValues) => Promise<LeadReceipt>;
  showToast: (message: string, type?: 'success' | 'info' | 'error') => void;
}

const ShopContext = createContext<ShopContextType | undefined>(undefined);

export const ShopProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // The cart is stored as { productId, quantity } only. Names, images and prices come from the live catalog.
  const [cartLines, setCartLines] = useState<CartLine[]>(() => {
    try {
      return parseStoredCart(localStorage.getItem('flaner_cart') || localStorage.getItem('lumiere_cart'));
    } catch {
      return [];
    }
  });

  // Favorites are a separate, device-local list of product ids. They never feed into a lead.
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    try {
      return parseStoredFavorites(localStorage.getItem('flaner_favorites'));
    } catch {
      return [];
    }
  });

  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');
  const [selectedBrand, setSelectedBrand] = useState<string | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'popular' | 'price-asc' | 'price-desc' | 'rating'>('popular');
  const [currency, setCurrency] = useState<Currency>('UZS');

  const [selectedProductForDetail, setSelectedProductForDetail] = useState<Product | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isLeadFormOpen, setIsLeadFormOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isTelegramFrame, setIsTelegramFrame] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);

  const [telegramUser, setTelegramUser] = useState<TelegramWebAppUser | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Initialize Telegram. initDataUnsafe is only used to pre-fill the form: it is NOT an identity. The identity of a
  // Telegram lead is decided by the backend from the signed initData.
  useEffect(() => {
    initTelegramApp();
    const user = getTelegramUser();
    if (user) {
      setTelegramUser(user);
    }
  }, []);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3200);
  };

  // The catalog always comes from the shared shop backend (GET /api/products). There is no bundled fallback list:
  // stale prices or stock would end up in leads.
  const loadCatalog = async () => {
    try {
      const response = await fetch(apiUrl('/api/products'), { credentials: 'omit' });
      if (!response.ok) throw new Error('Не удалось загрузить каталог с сервера.');
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Сервер вернул некорректный каталог товаров.');
      setProducts(data as Product[]);
      setCatalogStatus('ready');
    } catch (error: unknown) {
      console.error('Could not load product catalog:', error);
      setCatalogStatus((current) => (current === 'ready' ? current : 'error'));
      showToast(error instanceof Error ? error.message : 'Не удалось загрузить каталог.', 'error');
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  // Live view of the cart: each stored line joined with the current catalog entry.
  const cart: CartItem[] = useMemo(
    () => cartLines.flatMap((line) => {
      const product = productById.get(line.productId);
      return product ? [{ product, quantity: line.quantity }] : [];
    }),
    [cartLines, productById]
  );

  const favorites: Product[] = useMemo(
    () => favoriteIds.flatMap((id) => {
      const product = productById.get(id);
      return product ? [product] : [];
    }),
    [favoriteIds, productById]
  );

  // Once the real catalog is known, forget products that no longer exist (never before: an empty
  // catalog while loading must not wipe the shopper's saved cart).
  useEffect(() => {
    if (catalogStatus !== 'ready') return;
    const known = new Set(products.map((product) => product.id));
    const keptLines = cartLines.filter((line) => known.has(line.productId));
    if (keptLines.length !== cartLines.length) {
      setCartLines(keptLines);
      showToast('Некоторые товары больше недоступны и убраны из корзины', 'info');
    }
    const keptFavorites = favoriteIds.filter((id) => known.has(id));
    if (keptFavorites.length !== favoriteIds.length) setFavoriteIds(keptFavorites);
  }, [catalogStatus, products]);

  useEffect(() => {
    try {
      localStorage.setItem('flaner_cart', JSON.stringify(cartLines));
    } catch (e) {
      console.error(e);
    }
  }, [cartLines]);

  useEffect(() => {
    try {
      localStorage.setItem('flaner_favorites', JSON.stringify(favoriteIds));
    } catch (e) {
      console.error(e);
    }
  }, [favoriteIds]);

  const openProductDetail = (product: Product) => {
    triggerHaptic('light');
    setSelectedProductForDetail(product);
  };

  const closeProductDetail = () => {
    setSelectedProductForDetail(null);
  };

  const addToCart = (product: Product, quantity = 1) => {
    if (!product.inStock) {
      showToast(`«${product.name}» сейчас нет в наличии`, 'error');
      return;
    }
    const existing = cartLines.find((line) => line.productId === product.id);
    if (!existing && cartLines.length >= MAX_ITEMS_PER_LEAD) {
      showToast(`В заявке может быть не больше ${MAX_ITEMS_PER_LEAD} разных товаров`, 'error');
      return;
    }
    const nextQuantity = Math.min(MAX_QUANTITY_PER_ITEM, (existing?.quantity ?? 0) + quantity);
    if (existing && nextQuantity === existing.quantity) {
      showToast(`Максимум ${MAX_QUANTITY_PER_ITEM} шт. одного товара`, 'info');
      return;
    }
    triggerHaptic('medium');
    setCartLines((prev) => upsertLine(prev, product.id, nextQuantity));
    showToast(`«${product.name}» добавлен в корзину`);
  };

  const removeFromCart = (productId: string) => {
    triggerHaptic('light');
    setCartLines((prev) => prev.filter((line) => line.productId !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    triggerHaptic('selection');
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    if (quantity > MAX_QUANTITY_PER_ITEM) {
      showToast(`Максимум ${MAX_QUANTITY_PER_ITEM} шт. одного товара`, 'info');
      return;
    }
    setCartLines((prev) => upsertLine(prev, productId, quantity));
  };

  const clearCart = () => {
    setCartLines([]);
  };

  const toggleFavorite = (productId: string) => {
    triggerHaptic('light');
    setFavoriteIds((prev) => (prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]));
  };

  // One idempotency key per distinct submission (phone + cart). A retry after a timeout or a server error
  // reuses it, so the server can recognise it and never creates a second lead.
  const idempotencyRef = useRef<{ key: string; fingerprint: string } | null>(null);

  const submitLead = async (values: LeadFormValues): Promise<LeadReceipt> => {
    // Only the cart goes into a lead. Favorites are never read here.
    const items = cartLines.map((line) => ({ productId: line.productId, quantity: line.quantity }));
    if (!items.length) throw new LeadSubmitError('Корзина пуста', 'empty_cart');

    const fingerprint = `${normalizeUzPhone(values.phone) ?? values.phone}|${cartSignature(cartLines)}`;
    if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) {
      idempotencyRef.current = { key: createIdempotencyKey(), fingerprint };
    }

    // Read at submit time: the raw signed string is forwarded as is, and only the backend verifies it.
    const initData = getTelegramInitData();

    try {
      const receipt = await postLead(
        { ...values, items, idempotencyKey: idempotencyRef.current.key, ...(initData ? { initData } : {}) },
        fetch,
        API_BASE_URL
      );
      // Success (200 or 201): only now is the cart emptied.
      idempotencyRef.current = null;
      setCartLines([]);
      triggerHaptic('success');
      return receipt;
    } catch (error) {
      // Cart stays intact. If the catalog changed under the shopper, refresh it so the cart shows the truth.
      if (error instanceof LeadSubmitError && (error.code === 'product_unavailable' || error.code === 'out_of_stock')) {
        void loadCatalog();
      }
      triggerHaptic('error');
      throw error;
    }
  };

  return (
    <ShopContext.Provider
      value={{
        products,
        catalogStatus,
        cart,
        favorites,
        favoriteIds,
        selectedCategory,
        selectedBrand,
        searchQuery,
        sortBy,
        currency,
        selectedProductForDetail,
        isCartOpen,
        isLeadFormOpen,
        isFavoritesOpen,
        isTelegramFrame,
        isShareOpen,
        telegramUser,
        toast,
        setSelectedCategory,
        setSelectedBrand,
        setSearchQuery,
        setSortBy,
        setCurrency,
        setIsCartOpen,
        setIsLeadFormOpen,
        setIsFavoritesOpen,
        setIsTelegramFrame,
        setIsShareOpen,
        reloadCatalog: loadCatalog,
        openProductDetail,
        closeProductDetail,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        toggleFavorite,
        submitLead,
        showToast
      }}
    >
      {children}
    </ShopContext.Provider>
  );
};

export const useShop = () => {
  const context = useContext(ShopContext);
  if (!context) {
    throw new Error('useShop must be used within a ShopProvider');
  }
  return context;
};
