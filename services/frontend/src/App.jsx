import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import { CartProvider } from './cart/CartContext.jsx';
import { Layout } from './components/Layout.jsx';
import { PageLoader } from './components/ui.jsx';
import { Home } from './pages/Home.jsx';
import { Shop } from './pages/Shop.jsx';
import { ProductPage } from './pages/ProductPage.jsx';
import { CartPage } from './pages/CartPage.jsx';
import { Login } from './pages/Login.jsx';
import { Register } from './pages/Register.jsx';
import { VerifyEmail } from './pages/VerifyEmail.jsx';
import { ForgotPassword, ResetPassword } from './pages/PasswordReset.jsx';
import { NotFound } from './pages/NotFound.jsx';

// Les pages réservées aux utilisateurs connectés sont chargées à la demande.
const Checkout = lazy(() => import('./pages/Checkout.jsx').then((m) => ({ default: m.Checkout })));
const OrderConfirmation = lazy(() => import('./pages/Checkout.jsx').then((m) => ({ default: m.OrderConfirmation })));
const Account = lazy(() => import('./pages/account/Account.jsx').then((m) => ({ default: m.Account })));
const Profile = lazy(() => import('./pages/account/Profile.jsx').then((m) => ({ default: m.Profile })));
const Security = lazy(() => import('./pages/account/Security.jsx').then((m) => ({ default: m.Security })));
const Sessions = lazy(() => import('./pages/account/Sessions.jsx').then((m) => ({ default: m.Sessions })));
const Orders = lazy(() => import('./pages/account/Orders.jsx').then((m) => ({ default: m.Orders })));
const PersonalData = lazy(() => import('./pages/account/PersonalData.jsx').then((m) => ({ default: m.PersonalData })));

export function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="boutique" element={<Shop />} />
              <Route path="boutique/:slug" element={<ProductPage />} />
              <Route path="panier" element={<CartPage />} />
              <Route path="inscription" element={<Register />} />
              <Route path="connexion" element={<Login />} />
              <Route path="verifier-email" element={<VerifyEmail />} />
              <Route path="mot-de-passe-oublie" element={<ForgotPassword />} />
              <Route path="reinitialiser-mot-de-passe" element={<ResetPassword />} />
              <Route path="commande" element={<RequireAuth><Checkout /></RequireAuth>} />
              <Route path="commande/confirmation/:id" element={<RequireAuth><OrderConfirmation /></RequireAuth>} />
              <Route path="compte" element={<RequireAuth><Account /></RequireAuth>}>
                <Route index element={<Profile />} />
                <Route path="securite" element={<Security />} />
                <Route path="sessions" element={<Sessions />} />
                <Route path="commandes" element={<Orders />} />
                <Route path="donnees" element={<PersonalData />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </CartProvider>
    </AuthProvider>
  );
}
